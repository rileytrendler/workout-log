import type { Exercise, ExerciseLoadEntryMode, WorkoutSet } from "../db/types";

export const EXERCISE_LOAD_ENTRY_MODES: readonly ExerciseLoadEntryMode[] = [
  "standard", "paired", "expression"
];

export function getExerciseLoadEntryMode(
  exercise?: Pick<Exercise, "loadEntryMode">
): ExerciseLoadEntryMode {
  return exercise?.loadEntryMode ?? "standard";
}

export type LoadExpressionResult =
  | { valid: true; value: number; expression: string }
  | { valid: false; error: string };

const NUMBER = String.raw`(?:\d+(?:\.\d*)?|\.\d+)`;
const TERM = new RegExp(`^(${NUMBER})(?:\\s*[xX]\\s*(${NUMBER}))?$`);

/** Parses addition and multiplication only; multiplication is evaluated per term first. */
export function parseLoadExpression(input: string): LoadExpressionResult {
  const expression = input.trim();
  if (!expression) return { valid: false, error: "Enter a load expression, such as 7x45+25." };
  const terms = expression.split("+");
  let value = 0;
  for (const rawTerm of terms) {
    const match = rawTerm.trim().match(TERM);
    if (!match) {
      return { valid: false, error: "Use numbers with + and x only, such as 7x45+25." };
    }
    const left = Number(match[1]);
    const right = match[2] === undefined ? 1 : Number(match[2]);
    value += left * right;
  }
  if (!Number.isFinite(value)) return { valid: false, error: "This load expression is too large." };
  return { valid: true, value, expression };
}

export function loadExpressionMatchesWeight(expression: string, weight: number): boolean {
  const parsed = parseLoadExpression(expression);
  if (!parsed.valid) return false;
  const tolerance = Math.max(1, Math.abs(weight), Math.abs(parsed.value)) * 1e-9;
  return Math.abs(parsed.value - weight) <= tolerance;
}

export function formatSetLoad(
  set: Pick<WorkoutSet, "weight" | "loadExpression">,
  exercise?: Pick<Exercise, "loadEntryMode" | "defaultUnit">
): string {
  const weight = set.weight ?? "?";
  const unit = exercise?.defaultUnit ? ` ${exercise.defaultUnit}` : "";
  const mode = getExerciseLoadEntryMode(exercise);
  if (set.loadExpression) return `${set.loadExpression} (${weight}${unit})`;
  if (mode === "paired") return `${weight}${unit} each`;
  return `${weight}${unit}`;
}

export function getTotalExternalLoad(
  exercise: Pick<Exercise, "loadEntryMode">,
  set: Pick<WorkoutSet, "weight">
): number | undefined {
  if (set.weight === undefined) return undefined;
  return getExerciseLoadEntryMode(exercise) === "paired" ? set.weight * 2 : set.weight;
}
