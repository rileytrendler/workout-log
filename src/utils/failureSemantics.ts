import type { ExerciseMeasurementType, WorkoutSet } from "../db/types";

export type StoredRepResult = {
  reps: number;
  failedOnRep?: number;
};

export function encodeRepResult(enteredReps: number, failed: boolean): StoredRepResult {
  if (!Number.isInteger(enteredReps) || enteredReps < 1) {
    throw new Error(failed
      ? "A failed set needs an attempted rep of at least 1."
      : "A completed set must include at least one rep.");
  }
  return failed
    ? { reps: enteredReps - 1, failedOnRep: enteredReps }
    : { reps: enteredReps };
}

export function validateStoredRepResult(
  value: { reps?: unknown; failedOnRep?: unknown; actualRpe?: unknown },
  requireFailedRpe: boolean
): string | undefined {
  if (typeof value.reps !== "number" || !Number.isInteger(value.reps) || value.reps < 0) {
    return "completed reps must be a non-negative whole number";
  }
  if (value.failedOnRep === undefined) {
    return value.reps < 1 ? "a non-failed set must include at least one completed rep" : undefined;
  }
  if (typeof value.failedOnRep !== "number" || !Number.isInteger(value.failedOnRep) || value.failedOnRep < 1) {
    return "failedOnRep must be a positive whole number";
  }
  if (value.failedOnRep !== value.reps + 1) {
    return "failedOnRep must equal completed reps plus one";
  }
  if (requireFailedRpe && value.actualRpe !== 10) {
    return "a failed working set must be recorded at RPE 10";
  }
  return undefined;
}

export function isInCompletedRepRange(set: Pick<WorkoutSet, "reps">, min: number, max: number) {
  return set.reps !== undefined && set.reps >= min && set.reps <= max;
}

export function getEffectiveReps(
  set: Pick<WorkoutSet, "reps" | "failedOnRep">
): number | undefined {
  if (set.reps === undefined) return undefined;
  const hasValidFailure = typeof set.failedOnRep === "number" &&
    Number.isInteger(set.failedOnRep) && set.failedOnRep >= 1 &&
    set.failedOnRep === set.reps + 1;
  return set.reps + (hasValidFailure ? 0.5 : 0);
}

export function compareBestSetPerformance(
  a: Pick<WorkoutSet, "weight" | "reps" | "failedOnRep">,
  b: Pick<WorkoutSet, "weight" | "reps" | "failedOnRep">,
  measurementType: ExerciseMeasurementType
) {
  const effectiveRepsDifference = (getEffectiveReps(b) ?? -1) - (getEffectiveReps(a) ?? -1);
  if (measurementType === "reps_only") return effectiveRepsDifference;
  return (b.weight ?? Number.NEGATIVE_INFINITY) - (a.weight ?? Number.NEGATIVE_INFINITY) ||
    effectiveRepsDifference;
}

export function findFinalWorkingSet<T extends Pick<WorkoutSet, "isWarmup" | "setNumber">>(sets: T[]): T | undefined {
  return sets.filter((set) => set.isWarmup !== true)
    .sort((a, b) => b.setNumber - a.setNumber)[0];
}
