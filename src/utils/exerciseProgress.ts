import type { ExerciseMeasurementType, Workout, WorkoutExercise, WorkoutSet } from "../db/types";
import type { ExerciseHistorySession } from "../data/workoutRepository";
import { compareBestSetPerformance, getEffectiveReps, validateStoredRepResult } from "./failureSemantics";
import { getPersonalRecordEventTime, type PersonalRecordStatus } from "./personalRecords";

export type ExerciseProgressMetric = "best" | number;
export type ExerciseProgressRange = "all" | "3m" | "6m" | "1y";

export type ExerciseProgressPoint = {
  key: string;
  chartTime: number;
  timestamp: number;
  date: string;
  value: number;
  set: WorkoutSet;
  workout: Workout;
  workoutExercise: WorkoutExercise;
  gymName?: string;
  recordStatus?: PersonalRecordStatus;
};

function isChartableSet(set: WorkoutSet, measurementType: ExerciseMeasurementType) {
  if (set.isWarmup === true || validateStoredRepResult(set, false)) return false;
  if (measurementType === "reps_only") return getEffectiveReps(set) !== undefined;
  return typeof set.weight === "number" && Number.isFinite(set.weight);
}

function selectedSet(
  session: ExerciseHistorySession,
  measurementType: ExerciseMeasurementType,
  metric: ExerciseProgressMetric
) {
  const sets = session.sets.filter((set) => isChartableSet(set, measurementType));
  if (metric !== "best") return sets.find((set) => set.setNumber === metric);
  return sets.reduce<WorkoutSet | undefined>((best, set) =>
    !best || compareBestSetPerformance(set, best, measurementType) < 0 ? set : best, undefined);
}

function pointValue(set: WorkoutSet, measurementType: ExerciseMeasurementType) {
  return measurementType === "reps_only" ? getEffectiveReps(set) : set.weight;
}

/** Builds one chronologically ordered point per completed exercise session. */
export function buildExerciseProgressSeries(
  sessions: ExerciseHistorySession[],
  measurementType: ExerciseMeasurementType,
  metric: ExerciseProgressMetric,
  personalRecordStatuses?: ReadonlyMap<number, PersonalRecordStatus>
): ExerciseProgressPoint[] {
  const points = sessions.filter((session) => session.workout.status === "completed")
    .flatMap((session): ExerciseProgressPoint[] => {
      const set = selectedSet(session, measurementType, metric);
      const value = set && pointValue(set, measurementType);
      if (!set || value === undefined || !Number.isFinite(value)) return [];
      const timestamp = getPersonalRecordEventTime(set, session.workout);
      const setId = set.id;
      return [{
        key: `${session.workoutExercise.id ?? session.workout.id ?? session.workout.date}-${setId ?? set.setNumber}`,
        chartTime: timestamp,
        timestamp,
        date: session.workout.date,
        value,
        set,
        workout: session.workout,
        workoutExercise: session.workoutExercise,
        gymName: session.gymName,
        recordStatus: setId === undefined ? undefined : personalRecordStatuses?.get(setId)
      }];
    }).sort((a, b) => a.timestamp - b.timestamp ||
    a.date.localeCompare(b.date) ||
    (a.workout.id ?? 0) - (b.workout.id ?? 0) ||
    (a.workoutExercise.id ?? 0) - (b.workoutExercise.id ?? 0) ||
    a.set.setNumber - b.set.setNumber ||
    (a.set.id ?? 0) - (b.set.id ?? 0));

  // Preserve separate points even when imported data shares an exact timestamp.
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].chartTime <= points[index - 1].chartTime) {
      points[index].chartTime = points[index - 1].chartTime + 1;
    }
  }
  return points;
}

export function getObservedWorkingSetNumbers(
  sessions: ExerciseHistorySession[],
  measurementType: ExerciseMeasurementType
) {
  return [...new Set(sessions.filter((session) => session.workout.status === "completed")
    .flatMap((session) => session.sets
      .filter((set) => isChartableSet(set, measurementType))
      .map((set) => set.setNumber)))].sort((a, b) => a - b);
}

export function filterExerciseProgressRange(
  points: ExerciseProgressPoint[],
  range: ExerciseProgressRange,
  now = new Date()
) {
  if (range === "all") return points;
  const cutoff = new Date(now);
  if (range === "1y") cutoff.setFullYear(cutoff.getFullYear() - 1);
  else cutoff.setMonth(cutoff.getMonth() - (range === "3m" ? 3 : 6));
  return points.filter((point) => point.timestamp >= cutoff.getTime());
}
