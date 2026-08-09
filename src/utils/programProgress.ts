import type {
  ActiveProgramState,
  Exercise,
  ExerciseMeasurementType,
  Program,
  ProgramWorkout,
  Workout,
  WorkoutExercise,
  WorkoutExerciseQualityFlag,
  WorkoutSet
} from "../db/types";
import { compareBestSetPerformance } from "./failureSemantics";
import {
  derivePersonalRecordStatuses,
  isQualifyingPersonalRecordSet,
  type PersonalRecordStatus
} from "./personalRecords";
import { WORKOUT_EXERCISE_QUALITY_FLAGS } from "./qualityFlags";

export type ProgramProgressSource = {
  program: Program;
  activeState?: ActiveProgramState;
  plannedSlots: ProgramWorkout[];
  exercises: Exercise[];
  workouts: Workout[];
  workoutExercises: WorkoutExercise[];
  workoutSets: WorkoutSet[];
};

export type ProgramBestPerformance = {
  set: WorkoutSet;
  date: string;
  workoutId?: number;
};

export type ProgramExerciseCycleStats = {
  exerciseId: number;
  exerciseName: string;
  measurementType: ExerciseMeasurementType;
  unit: "lb" | "kg";
  best?: ProgramBestPerformance;
  prCount: number;
  setPrCount: number;
  qualityFlags: Partial<Record<WorkoutExerciseQualityFlag, number>>;
};

export type ProgramCycleProgress = {
  cycleNumber: number;
  workoutCount: number;
  plannedWorkoutCount: number;
  completedSlotCount: number;
  isComplete: boolean;
  isInProgress: boolean;
  prCount: number;
  setPrCount: number;
  qualityFlagSessionCount: number;
  qualityFlags: Partial<Record<WorkoutExerciseQualityFlag, number>>;
  qualityExercises: Partial<Record<WorkoutExerciseQualityFlag, string[]>>;
  exercises: ProgramExerciseCycleStats[];
};

export type ProgramExerciseComparisonState =
  | "improved"
  | "same"
  | "down"
  | "new"
  | "not_performed"
  | "not_yet_performed";

export type ProgramExerciseComparison = {
  exerciseId: number;
  exerciseName: string;
  measurementType: ExerciseMeasurementType;
  unit: "lb" | "kg";
  earlier?: ProgramExerciseCycleStats;
  later?: ProgramExerciseCycleStats;
  state: ProgramExerciseComparisonState;
  noCycleImprovement: boolean;
};

export type ProgramCycleComparison = {
  earlierCycle: number;
  laterCycle: number;
  laterIsInProgress: boolean;
  exercises: ProgramExerciseComparison[];
  counts: Record<"improved" | "same" | "down" | "notComparable", number>;
};

export type ProgramProgress = {
  summary: {
    workoutCount: number;
    completedCycleCount: number;
    currentCycle?: number;
    prCount: number;
    setPrCount: number;
    exerciseCount: number;
    qualityFlagSessionCount: number;
    workoutsWithoutCycleProvenance: number;
  };
  cycles: ProgramCycleProgress[];
};

function keyedById<T extends { id?: number }>(rows: T[]) {
  return new Map(rows.flatMap((row) => row.id === undefined ? [] : [[row.id, row] as const]));
}

function addFlagSession(
  target: Partial<Record<WorkoutExerciseQualityFlag, Set<number>>>,
  flags: WorkoutExerciseQualityFlag[] | undefined,
  workoutId: number
) {
  for (const flag of flags ?? []) {
    const sessions = target[flag] ?? new Set<number>();
    sessions.add(workoutId);
    target[flag] = sessions;
  }
}

function sizes(target: Partial<Record<WorkoutExerciseQualityFlag, Set<number>>>) {
  const result: Partial<Record<WorkoutExerciseQualityFlag, number>> = {};
  for (const flag of WORKOUT_EXERCISE_QUALITY_FLAGS) {
    const count = target[flag]?.size;
    if (count) result[flag] = count;
  }
  return result;
}

/** Pure derivation. Program membership comes only from completed workouts with matching programId. */
export function buildProgramProgress(source: ProgramProgressSource): ProgramProgress {
  const programId = source.program.id;
  const programWorkouts = source.workouts.filter((workout) =>
    programId !== undefined && workout.programId === programId && workout.status === "completed");
  const workoutById = keyedById(programWorkouts);
  const exerciseById = keyedById(source.exercises);
  const relevantWorkoutExercises = source.workoutExercises.filter((row) => workoutById.has(row.workoutId));
  const workoutExerciseById = keyedById(relevantWorkoutExercises);
  const relevantSets = source.workoutSets.filter((set) => workoutExerciseById.has(set.workoutExerciseId));
  const setsByWorkoutExercise = new Map<number, WorkoutSet[]>();
  for (const set of relevantSets) {
    const values = setsByWorkoutExercise.get(set.workoutExerciseId) ?? [];
    values.push(set);
    setsByWorkoutExercise.set(set.workoutExerciseId, values);
  }

  const recordStatuses = derivePersonalRecordStatuses(source);
  const plannedSlotIds = new Set(source.plannedSlots.flatMap((slot) => slot.id ?? []));
  const validCycleNumbers = [...new Set(programWorkouts.flatMap((workout) =>
    Number.isInteger(workout.programCycleNumber) && workout.programCycleNumber! > 0
      ? [workout.programCycleNumber!]
      : []))].sort((a, b) => a - b);
  const activeState = source.activeState;
  const activeCycle = activeState && activeState.programId === programId ? activeState.cycleNumber : undefined;
  const allFlagSessions: Partial<Record<WorkoutExerciseQualityFlag, Set<number>>> = {};
  const performedExerciseIds = new Set<number>();
  let totalPrCount = 0;
  let totalSetPrCount = 0;

  for (const row of relevantWorkoutExercises) {
    addFlagSession(allFlagSessions, row.qualityFlags, row.workoutId);
    const exercise = exerciseById.get(row.exerciseId);
    const type = exercise?.measurementType ?? "weight_reps";
    const qualifyingSets = (row.id === undefined ? [] : setsByWorkoutExercise.get(row.id) ?? [])
      .filter((set) => isQualifyingPersonalRecordSet(set, type));
    if (qualifyingSets.length) performedExerciseIds.add(row.exerciseId);
    for (const set of qualifyingSets) {
      const status = set.id === undefined ? undefined : recordStatuses.get(set.id);
      if (status?.isAbsolutePR) totalPrCount += 1;
      else if (status?.isSetPR) totalSetPrCount += 1;
    }
  }

  const cycles = validCycleNumbers.map((cycleNumber): ProgramCycleProgress => {
    const workouts = programWorkouts.filter((workout) => workout.programCycleNumber === cycleNumber);
    const cycleWorkoutById = keyedById(workouts);
    const rows = relevantWorkoutExercises.filter((row) => cycleWorkoutById.has(row.workoutId));
    const completedSlotIds = new Set(workouts.flatMap((workout) =>
      workout.programWorkoutId !== undefined && plannedSlotIds.has(workout.programWorkoutId)
        ? [workout.programWorkoutId]
        : []));
    const hasFullCurrentCoverage = plannedSlotIds.size > 0 && completedSlotIds.size === plannedSlotIds.size;
    const laterCycleEvidence = validCycleNumbers.some((value) => value > cycleNumber) ||
      (activeCycle !== undefined && activeCycle > cycleNumber);
    const isComplete = source.program.endBehavior === "repeat"
      ? laterCycleEvidence || hasFullCurrentCoverage
      : cycleNumber === 1 && hasFullCurrentCoverage;
    const flagSessions: Partial<Record<WorkoutExerciseQualityFlag, Set<number>>> = {};
    const flagExerciseNames: Partial<Record<WorkoutExerciseQualityFlag, Set<string>>> = {};
    const statsByExercise = new Map<number, ProgramExerciseCycleStats>();

    for (const row of rows) {
      const workout = cycleWorkoutById.get(row.workoutId)!;
      const exercise = exerciseById.get(row.exerciseId);
      const measurementType = exercise?.measurementType ?? "weight_reps";
      const stats = statsByExercise.get(row.exerciseId) ?? {
        exerciseId: row.exerciseId,
        exerciseName: exercise?.name ?? `Exercise ${row.exerciseId}`,
        measurementType,
        unit: exercise?.defaultUnit ?? "lb",
        prCount: 0,
        setPrCount: 0,
        qualityFlags: {}
      };
      addFlagSession(flagSessions, row.qualityFlags, row.workoutId);
      for (const flag of row.qualityFlags ?? []) {
        const sessions = flagExerciseNames[flag] ?? new Set<string>();
        sessions.add(stats.exerciseName);
        flagExerciseNames[flag] = sessions;
        stats.qualityFlags[flag] = (stats.qualityFlags[flag] ?? 0) + 1;
      }
      const qualifyingSets = (row.id === undefined ? [] : setsByWorkoutExercise.get(row.id) ?? [])
        .filter((set) => isQualifyingPersonalRecordSet(set, measurementType));
      for (const set of qualifyingSets) {
        if (!stats.best || compareBestSetPerformance(set, stats.best.set, measurementType) < 0) {
          stats.best = { set, date: workout.date, workoutId: workout.id };
        }
        const status: PersonalRecordStatus | undefined = set.id === undefined ? undefined : recordStatuses.get(set.id);
        if (status?.isAbsolutePR) stats.prCount += 1;
        else if (status?.isSetPR) stats.setPrCount += 1;
      }
      statsByExercise.set(row.exerciseId, stats);
    }
    const exercises = [...statsByExercise.values()].filter((stats) => stats.best)
      .sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
    const qualityFlags = sizes(flagSessions);
    return {
      cycleNumber,
      workoutCount: workouts.length,
      plannedWorkoutCount: plannedSlotIds.size,
      completedSlotCount: completedSlotIds.size,
      isComplete,
      isInProgress: activeCycle === cycleNumber,
      prCount: exercises.reduce((sum, item) => sum + item.prCount, 0),
      setPrCount: exercises.reduce((sum, item) => sum + item.setPrCount, 0),
      qualityFlagSessionCount: new Set(Object.values(flagSessions).flatMap((sessions) => [...(sessions ?? [])])).size,
      qualityFlags,
      qualityExercises: Object.fromEntries(WORKOUT_EXERCISE_QUALITY_FLAGS.flatMap((flag) => {
        const names = flagExerciseNames[flag];
        return names?.size ? [[flag, [...names].sort()]] : [];
      })),
      exercises
    };
  });

  return {
    summary: {
      workoutCount: programWorkouts.length,
      completedCycleCount: cycles.filter((cycle) => cycle.isComplete).length,
      currentCycle: activeCycle,
      prCount: totalPrCount,
      setPrCount: totalSetPrCount,
      exerciseCount: performedExerciseIds.size,
      qualityFlagSessionCount: new Set(Object.values(allFlagSessions).flatMap((sessions) => [...(sessions ?? [])])).size,
      workoutsWithoutCycleProvenance: programWorkouts.filter((workout) =>
        !Number.isInteger(workout.programCycleNumber) || workout.programCycleNumber! < 1).length
    },
    cycles
  };
}

export function compareProgramCycles(
  progress: ProgramProgress,
  earlierCycle: number,
  laterCycle: number
): ProgramCycleComparison | undefined {
  const earlier = progress.cycles.find((cycle) => cycle.cycleNumber === earlierCycle);
  const later = progress.cycles.find((cycle) => cycle.cycleNumber === laterCycle);
  if (!earlier || !later || earlierCycle >= laterCycle) return undefined;
  const earlierById = new Map(earlier.exercises.map((item) => [item.exerciseId, item]));
  const laterById = new Map(later.exercises.map((item) => [item.exerciseId, item]));
  const exerciseIds = [...new Set([...earlierById.keys(), ...laterById.keys()])];
  const exercises = exerciseIds.map((exerciseId): ProgramExerciseComparison => {
    const earlierExercise = earlierById.get(exerciseId);
    const laterExercise = laterById.get(exerciseId);
    let state: ProgramExerciseComparisonState;
    if (!earlierExercise) state = "new";
    else if (!laterExercise) state = later.isInProgress ? "not_yet_performed" : "not_performed";
    else {
      const result = compareBestSetPerformance(
        laterExercise.best!.set,
        earlierExercise.best!.set,
        laterExercise.measurementType
      );
      state = result < 0 ? "improved" : result > 0 ? "down" : "same";
    }
    return {
      exerciseId,
      exerciseName: laterExercise?.exerciseName ?? earlierExercise!.exerciseName,
      measurementType: laterExercise?.measurementType ?? earlierExercise!.measurementType,
      unit: laterExercise?.unit ?? earlierExercise!.unit,
      earlier: earlierExercise,
      later: laterExercise,
      state,
      noCycleImprovement: (state === "same" || state === "down") &&
        laterExercise !== undefined && laterExercise.prCount + laterExercise.setPrCount === 0
    };
  }).sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
  return {
    earlierCycle,
    laterCycle,
    laterIsInProgress: later.isInProgress,
    exercises,
    counts: {
      improved: exercises.filter((item) => item.state === "improved").length,
      same: exercises.filter((item) => item.state === "same").length,
      down: exercises.filter((item) => item.state === "down").length,
      notComparable: exercises.filter((item) => !["improved", "same", "down"].includes(item.state)).length
    }
  };
}
