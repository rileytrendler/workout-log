import type {
  Exercise,
  ExerciseMeasurementType,
  Workout,
  WorkoutExercise,
  WorkoutSet
} from "../db/types";
import { compareBestSetPerformance, validateStoredRepResult } from "./failureSemantics";

type PersistedSet = WorkoutSet & { id: number };

type PersonalRecordCandidate = {
  set: PersistedSet;
  workout: Workout;
  workoutExercise: WorkoutExercise;
  measurementType: ExerciseMeasurementType;
};

export type PersonalRecordSource = {
  exercises: Exercise[];
  workouts: Workout[];
  workoutExercises: WorkoutExercise[];
  workoutSets: WorkoutSet[];
};

export type PersonalRecordStatus = {
  isAbsolutePR: boolean;
  isSetPR: boolean;
};

function timestamp(value?: string) {
  if (!value) return Number.NaN;
  return new Date(value).getTime();
}

function candidateTime(candidate: PersonalRecordCandidate) {
  for (const value of [
    candidate.set.performedAt,
    candidate.set.createdAt,
    candidate.workout.startTime,
    candidate.workout.createdAt,
    `${candidate.workout.date}T00:00:00`
  ]) {
    const time = timestamp(value);
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

function compareChronology(a: PersonalRecordCandidate, b: PersonalRecordCandidate) {
  return candidateTime(a) - candidateTime(b) ||
    a.workout.date.localeCompare(b.workout.date) ||
    (a.workout.id ?? 0) - (b.workout.id ?? 0) ||
    a.workoutExercise.order - b.workoutExercise.order ||
    a.set.setNumber - b.set.setNumber ||
    a.set.id - b.set.id;
}

function isQualifyingSet(set: WorkoutSet, measurementType: ExerciseMeasurementType): set is PersistedSet {
  if (set.id === undefined || set.isWarmup === true || validateStoredRepResult(set, false)) return false;
  return measurementType === "reps_only" ||
    (typeof set.weight === "number" && Number.isFinite(set.weight));
}

export function doesSetBeatPriorRecord(
  set: Pick<WorkoutSet, "weight" | "reps" | "failedOnRep">,
  priorRecord: Pick<WorkoutSet, "weight" | "reps" | "failedOnRep"> | undefined,
  measurementType: ExerciseMeasurementType
) {
  return priorRecord === undefined || compareBestSetPerformance(set, priorRecord, measurementType) < 0;
}

/** Derives the records that each set established at the time it was performed. */
export function derivePersonalRecordStatuses(source: PersonalRecordSource): Map<number, PersonalRecordStatus> {
  const workoutById = new Map(source.workouts.flatMap((workout) =>
    workout.id === undefined ? [] : [[workout.id, workout] as const]));
  const exerciseById = new Map(source.exercises.flatMap((exercise) =>
    exercise.id === undefined ? [] : [[exercise.id, exercise] as const]));
  const workoutExerciseById = new Map(source.workoutExercises.flatMap((workoutExercise) =>
    workoutExercise.id === undefined ? [] : [[workoutExercise.id, workoutExercise] as const]));

  const candidates = source.workoutSets.flatMap((set): PersonalRecordCandidate[] => {
    const workoutExercise = workoutExerciseById.get(set.workoutExerciseId);
    const workout = workoutExercise && workoutById.get(workoutExercise.workoutId);
    if (!workoutExercise || !workout) return [];
    const measurementType = exerciseById.get(workoutExercise.exerciseId)?.measurementType ?? "weight_reps";
    return isQualifyingSet(set, measurementType)
      ? [{ set, workout, workoutExercise, measurementType }]
      : [];
  }).sort(compareChronology);

  const absoluteRecordByExerciseId = new Map<number, PersistedSet>();
  const setRecordByExerciseAndNumber = new Map<number, Map<number, PersistedSet>>();
  const personalRecordStatuses = new Map<number, PersonalRecordStatus>();
  for (const candidate of candidates) {
    const exerciseId = candidate.workoutExercise.exerciseId;
    const recordsBySetNumber = setRecordByExerciseAndNumber.get(exerciseId) ?? new Map<number, PersistedSet>();
    const isAbsolutePR = doesSetBeatPriorRecord(
      candidate.set,
      absoluteRecordByExerciseId.get(exerciseId),
      candidate.measurementType
    );
    const isSetPR = doesSetBeatPriorRecord(
      candidate.set,
      recordsBySetNumber.get(candidate.set.setNumber),
      candidate.measurementType
    );

    if (isAbsolutePR || isSetPR) {
      personalRecordStatuses.set(candidate.set.id, { isAbsolutePR, isSetPR });
    }
    if (isAbsolutePR) absoluteRecordByExerciseId.set(exerciseId, candidate.set);
    if (isSetPR) {
      recordsBySetNumber.set(candidate.set.setNumber, candidate.set);
      setRecordByExerciseAndNumber.set(exerciseId, recordsBySetNumber);
    }
  }
  return personalRecordStatuses;
}
