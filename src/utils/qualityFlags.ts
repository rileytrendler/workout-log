import type { WorkoutExerciseQualityFlag } from "../db/types";

export const WORKOUT_EXERCISE_QUALITY_FLAGS: readonly WorkoutExerciseQualityFlag[] = [
  "form_issue",
  "pain_discomfort",
  "setup_issue",
  "low_energy"
];

export const WORKOUT_EXERCISE_QUALITY_FLAG_LABELS: Record<WorkoutExerciseQualityFlag, string> = {
  form_issue: "Form issue",
  pain_discomfort: "Pain / discomfort",
  setup_issue: "Setup issue",
  low_energy: "Low energy"
};

export function isWorkoutExerciseQualityFlag(value: unknown): value is WorkoutExerciseQualityFlag {
  return typeof value === "string" &&
    WORKOUT_EXERCISE_QUALITY_FLAGS.includes(value as WorkoutExerciseQualityFlag);
}

export function validateWorkoutExerciseQualityFlags(value: unknown): WorkoutExerciseQualityFlag[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((flag) => !isWorkoutExerciseQualityFlag(flag))) {
    throw new Error("The backup contains an invalid workout exercise quality flag.");
  }

  return WORKOUT_EXERCISE_QUALITY_FLAGS.filter((flag) => value.includes(flag));
}

export function qualityFlagLabels(flags?: readonly WorkoutExerciseQualityFlag[]): string[] {
  return WORKOUT_EXERCISE_QUALITY_FLAGS
    .filter((flag) => flags?.includes(flag))
    .map((flag) => WORKOUT_EXERCISE_QUALITY_FLAG_LABELS[flag]);
}
