import type {
  ExerciseMeasurementType,
  Exercise,
  WorkoutExercise,
  WorkoutSet,
  WorkoutSetMyoSet
} from "../db/types";
import { intensityTechniqueLabel } from "./intensityTechniques";
import { formatSetLoad } from "./loadFormatting";

export function formatReps(set: Pick<WorkoutSet, "reps" | "failedOnRep">): string {
  return set.failedOnRep === undefined ? String(set.reps ?? "?") : `${set.failedOnRep}f`;
}

export function formatSetPerformance(
  set: WorkoutSet,
  type: ExerciseMeasurementType,
  exercise?: Pick<Exercise, "loadEntryMode" | "defaultUnit">
): string {
  const reps = formatReps(set);
  const rpe = set.actualRpe === undefined ? "" : ` @ ${set.actualRpe}`;
  if (type === "reps_only") return `${reps}${rpe}`;
  if (type === "bodyweight_added_weight") {
    const prefix = set.weight ? `Bodyweight + ${set.weight}` : "Bodyweight";
    return `${prefix} × ${reps}${rpe}`;
  }
  return `${formatSetLoad(set, exercise)} × ${reps}${rpe}`;
}

export function formatActualTechniqueDetails(
  workoutExercise: Pick<WorkoutExercise, "actualLastSetIntensityTechnique" | "longLengthPartialReps">,
  myoSets: Array<Pick<WorkoutSetMyoSet, "reps" | "failedOnRep">> = []
): string | undefined {
  const technique = workoutExercise.actualLastSetIntensityTechnique;
  if (!technique) return undefined;

  const label = intensityTechniqueLabel(technique)!;
  if (technique === "failure_llps" && workoutExercise.longLengthPartialReps !== undefined) {
    return `${label} · ${workoutExercise.longLengthPartialReps} partials`;
  }
  if (technique === "myo_reps" && myoSets.length) {
    return `${label} · ${myoSets.map(formatReps).join(", ")}`;
  }
  return label;
}
