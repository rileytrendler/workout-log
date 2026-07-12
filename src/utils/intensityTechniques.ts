import type { LastSetIntensityTechnique } from "../db/types";

export const LAST_SET_INTENSITY_TECHNIQUES = ["failure", "failure_llps", "myo_reps"] as const;

export const LAST_SET_INTENSITY_LABELS: Record<LastSetIntensityTechnique, string> = {
  failure: "Failure",
  failure_llps: "Failure + LLPs",
  myo_reps: "Myo-reps"
};

export function isLastSetIntensityTechnique(value: unknown): value is LastSetIntensityTechnique {
  return typeof value === "string" && LAST_SET_INTENSITY_TECHNIQUES.includes(value as LastSetIntensityTechnique);
}

export function intensityTechniqueLabel(value?: LastSetIntensityTechnique) {
  return value ? LAST_SET_INTENSITY_LABELS[value] : undefined;
}
