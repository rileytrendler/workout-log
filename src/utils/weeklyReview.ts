import type {
  Exercise,
  Workout,
  WorkoutExercise,
  WorkoutExerciseQualityFlag,
  WorkoutSet
} from "../db/types";
import {
  derivePersonalRecordStatuses,
  getPersonalRecordEventTime,
  isQualifyingPersonalRecordSet
} from "./personalRecords";
import { WORKOUT_EXERCISE_QUALITY_FLAGS } from "./qualityFlags";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 7 * DAY_MS;

export type WeeklyReviewCounts = {
  workoutCount: number;
  exerciseSessionCount: number;
  absolutePRCount: number;
  setPRCount: number;
};

export type ImprovedExercise = {
  exerciseId: number;
  exerciseName: string;
  absolutePRCount: number;
  setPRCount: number;
  mostRecentAt: number;
};

export type StagnationWatchItem = {
  exerciseId: number;
  exerciseName: string;
  daysSinceProgress: number;
  sessionCount: number;
  severity: "watch" | "stagnant";
};

export type QualityFlagCount = {
  flag: WorkoutExerciseQualityFlag;
  sessionCount: number;
};

export type QualityFlagSummary = {
  exerciseId: number;
  exerciseName: string;
  flags: QualityFlagCount[];
};

export type WeeklyReview = {
  windowStart: Date;
  windowEnd: Date;
  previousWindowStart: Date;
  current: WeeklyReviewCounts;
  previous: WeeklyReviewCounts;
  improvedExercises: ImprovedExercise[];
  stagnationWatch: StagnationWatchItem[];
  qualityFlagSummary: QualityFlagSummary[];
};

export type WeeklyReviewSource = {
  exercises: Exercise[];
  workouts: Workout[];
  workoutExercises: WorkoutExercise[];
  workoutSets: WorkoutSet[];
};

type ExerciseSession = {
  workoutExercise: WorkoutExercise & { id: number };
  exercise: Exercise;
  time: number;
  sets: Array<WorkoutSet & { id: number }>;
};

function timestamp(value?: string) {
  if (!value) return Number.NaN;
  return new Date(value).getTime();
}

/** Uses the same occurrence fallback order as workout history sorting, then the local workout date. */
function workoutTime(workout: Workout) {
  for (const value of [workout.startTime, workout.createdAt, `${workout.date}T00:00:00`]) {
    const time = timestamp(value);
    if (Number.isFinite(time)) return time;
  }
  return Number.NaN;
}

function inWindow(time: number, start: number, end: number, includeEnd = false) {
  return time >= start && (includeEnd ? time <= end : time < end);
}

function emptyCounts(): WeeklyReviewCounts {
  return { workoutCount: 0, exerciseSessionCount: 0, absolutePRCount: 0, setPRCount: 0 };
}

export function buildWeeklyReview(source: WeeklyReviewSource, now: Date = new Date()): WeeklyReview {
  const windowEnd = now.getTime();
  if (!Number.isFinite(windowEnd)) throw new Error("Weekly Review requires a valid current time.");
  const windowStart = windowEnd - WINDOW_MS;
  const previousWindowStart = windowStart - WINDOW_MS;
  const exerciseById = new Map(source.exercises.flatMap((exercise) =>
    exercise.id === undefined ? [] : [[exercise.id, exercise] as const]));
  const completedWorkouts = source.workouts.filter((workout) => workout.status === "completed");
  const workoutById = new Map(completedWorkouts.flatMap((workout) =>
    workout.id === undefined ? [] : [[workout.id, workout] as const]));
  const setsByWorkoutExerciseId = new Map<number, WorkoutSet[]>();
  for (const set of source.workoutSets) {
    const values = setsByWorkoutExerciseId.get(set.workoutExerciseId) ?? [];
    values.push(set);
    setsByWorkoutExerciseId.set(set.workoutExerciseId, values);
  }

  const sessions = source.workoutExercises.flatMap((workoutExercise): ExerciseSession[] => {
    if (workoutExercise.id === undefined || !workoutById.has(workoutExercise.workoutId)) return [];
    const exercise = exerciseById.get(workoutExercise.exerciseId);
    if (!exercise) return [];
    const measurementType = exercise.measurementType ?? "weight_reps";
    const workout = workoutById.get(workoutExercise.workoutId)!;
    const sets = (setsByWorkoutExerciseId.get(workoutExercise.id) ?? [])
      .filter((set) => isQualifyingPersonalRecordSet(set, measurementType));
    if (!sets.length) return [];
    const times = sets.map((set) => getPersonalRecordEventTime(set, workout)).filter(Number.isFinite);
    if (!times.length) return [];
    return [{ workoutExercise: { ...workoutExercise, id: workoutExercise.id }, exercise,
      time: Math.min(...times), sets }];
  }).filter((session) => session.time <= windowEnd);

  const completedWorkoutExercises = sessions.map((session) => session.workoutExercise);
  const completedSetIds = new Set(sessions.flatMap((session) => session.sets.map((set) => set.id)));
  const completedSets = source.workoutSets.filter((set) => set.id !== undefined && completedSetIds.has(set.id));
  const recordStatuses = derivePersonalRecordStatuses({
    exercises: source.exercises,
    workouts: completedWorkouts,
    workoutExercises: completedWorkoutExercises,
    workoutSets: completedSets
  });
  const workoutExerciseById = new Map(completedWorkoutExercises.map((row) => [row.id, row]));
  const setById = new Map(completedSets.flatMap((set) =>
    set.id === undefined ? [] : [[set.id, set] as const]));

  const records = completedSets.flatMap((set) => {
    const status = set.id === undefined ? undefined : recordStatuses.get(set.id);
    const workoutExercise = workoutExerciseById.get(set.workoutExerciseId);
    const workout = workoutExercise && workoutById.get(workoutExercise.workoutId);
    if (!status || !workoutExercise || !workout) return [];
    return [{ setId: set.id!, exerciseId: workoutExercise.exerciseId,
      time: getPersonalRecordEventTime(set, workout), ...status }];
  }).filter((record) => record.time <= windowEnd);

  function countsFor(start: number, end: number, includeEnd = false): WeeklyReviewCounts {
    const counts = emptyCounts();
    counts.workoutCount = completedWorkouts.filter((workout) => {
      const time = workoutTime(workout);
      return Number.isFinite(time) && inWindow(time, start, end, includeEnd);
    }).length;
    counts.exerciseSessionCount = sessions.filter((session) => inWindow(session.time, start, end, includeEnd)).length;
    for (const record of records.filter((value) => inWindow(value.time, start, end, includeEnd))) {
      if (record.isAbsolutePR) counts.absolutePRCount += 1;
      else if (record.isSetPR) counts.setPRCount += 1;
    }
    return counts;
  }

  const improvementsByExercise = new Map<number, ImprovedExercise>();
  for (const record of records.filter((value) => inWindow(value.time, windowStart, windowEnd, true))) {
    const exercise = exerciseById.get(record.exerciseId);
    if (!exercise) continue;
    const item = improvementsByExercise.get(record.exerciseId) ?? {
      exerciseId: record.exerciseId, exerciseName: exercise.name,
      absolutePRCount: 0, setPRCount: 0, mostRecentAt: record.time
    };
    if (record.isAbsolutePR) item.absolutePRCount += 1;
    else if (record.isSetPR) item.setPRCount += 1;
    item.mostRecentAt = Math.max(item.mostRecentAt, record.time);
    improvementsByExercise.set(record.exerciseId, item);
  }

  const sessionsByExercise = new Map<number, ExerciseSession[]>();
  for (const session of sessions) {
    const values = sessionsByExercise.get(session.workoutExercise.exerciseId) ?? [];
    values.push(session);
    sessionsByExercise.set(session.workoutExercise.exerciseId, values);
  }
  const stagnationWatch: StagnationWatchItem[] = [];
  for (const [exerciseId, exerciseSessions] of sessionsByExercise) {
    exerciseSessions.sort((a, b) => a.time - b.time);
    if (exerciseSessions.length < 3) continue;
    const firstSessionAt = exerciseSessions[0].time;
    const mostRecentSessionAt = exerciseSessions.at(-1)!.time;
    if (mostRecentSessionAt - firstSessionAt < 21 * DAY_MS ||
      mostRecentSessionAt < windowEnd - 14 * DAY_MS) continue;
    const exerciseRecords = records.filter((record) => record.exerciseId === exerciseId)
      .sort((a, b) => a.time - b.time);
    const recordSessionIds = new Set(exerciseRecords.map((record) =>
      setById.get(record.setId)?.workoutExerciseId));
    const baseline = recordSessionIds.size <= 1 ? firstSessionAt : exerciseRecords.at(-1)?.time ?? firstSessionAt;
    const elapsed = windowEnd - baseline;
    if (elapsed < 21 * DAY_MS) continue;
    const exercise = exerciseById.get(exerciseId);
    if (!exercise) continue;
    stagnationWatch.push({ exerciseId, exerciseName: exercise.name,
      daysSinceProgress: Math.floor(elapsed / DAY_MS), sessionCount: exerciseSessions.length,
      severity: elapsed >= 28 * DAY_MS ? "stagnant" : "watch" });
  }

  const qualityByExercise = new Map<number, Map<WorkoutExerciseQualityFlag, number>>();
  for (const session of sessions.filter((value) => inWindow(value.time, windowStart, windowEnd, true))) {
    for (const flag of WORKOUT_EXERCISE_QUALITY_FLAGS) {
      if (!session.workoutExercise.qualityFlags?.includes(flag)) continue;
      const counts = qualityByExercise.get(session.workoutExercise.exerciseId) ?? new Map();
      counts.set(flag, (counts.get(flag) ?? 0) + 1);
      qualityByExercise.set(session.workoutExercise.exerciseId, counts);
    }
  }
  const qualityFlagSummary = [...qualityByExercise].flatMap(([exerciseId, flagCounts]): QualityFlagSummary[] => {
    const exercise = exerciseById.get(exerciseId);
    return exercise ? [{ exerciseId, exerciseName: exercise.name,
      flags: WORKOUT_EXERCISE_QUALITY_FLAGS.flatMap((flag) => {
        const sessionCount = flagCounts.get(flag);
        return sessionCount ? [{ flag, sessionCount }] : [];
      }) }] : [];
  }).sort((a, b) => Number(b.flags.some((item) => item.flag === "form_issue")) -
    Number(a.flags.some((item) => item.flag === "form_issue")) || a.exerciseName.localeCompare(b.exerciseName));

  return {
    windowStart: new Date(windowStart), windowEnd: new Date(windowEnd),
    previousWindowStart: new Date(previousWindowStart),
    current: countsFor(windowStart, windowEnd, true),
    previous: countsFor(previousWindowStart, windowStart),
    improvedExercises: [...improvementsByExercise.values()].sort((a, b) =>
      b.mostRecentAt - a.mostRecentAt || a.exerciseName.localeCompare(b.exerciseName)),
    stagnationWatch: stagnationWatch.sort((a, b) =>
      b.daysSinceProgress - a.daysSinceProgress || a.exerciseName.localeCompare(b.exerciseName)),
    qualityFlagSummary
  };
}
