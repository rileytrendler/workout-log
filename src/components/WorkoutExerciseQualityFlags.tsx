import { useState } from "react";
import type { WorkoutExerciseQualityFlag } from "../db/types";
import { updateWorkoutExerciseQualityFlags } from "../data/workoutRepository";
import {
  qualityFlagLabels,
  WORKOUT_EXERCISE_QUALITY_FLAG_LABELS,
  WORKOUT_EXERCISE_QUALITY_FLAGS
} from "../utils/qualityFlags";

export function QualityFlagSummary({ flags }: { flags?: readonly WorkoutExerciseQualityFlag[] }) {
  const labels = qualityFlagLabels(flags);
  return labels.length ? <p className="quality-flag-summary">{labels.join(" · ")}</p> : null;
}

export function WorkoutExerciseQualityFlags({
  workoutExerciseId,
  flags,
  showSummary = true
}: {
  workoutExerciseId: number;
  flags?: readonly WorkoutExerciseQualityFlag[];
  showSummary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function toggle(flag: WorkoutExerciseQualityFlag) {
    const selected = new Set(flags ?? []);
    if (selected.has(flag)) selected.delete(flag);
    else selected.add(flag);
    const next = WORKOUT_EXERCISE_QUALITY_FLAGS.filter((candidate) => selected.has(candidate));

    setSaving(true);
    try {
      await updateWorkoutExerciseQualityFlags(workoutExerciseId, [...next]);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Quality flags could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="quality-flags-control">
    <div className="quality-flags-heading">
      {showSummary && <QualityFlagSummary flags={flags} />}
      <button type="button" className="secondary-button tiny-button" aria-expanded={open}
        onClick={() => setOpen((current) => !current)}>
        Flags{flags?.length ? ` (${flags.length})` : ""}
      </button>
    </div>
    {open && <div className="quality-flags-panel" role="group" aria-label="Exercise quality flags">
      {WORKOUT_EXERCISE_QUALITY_FLAGS.map((flag) => <label key={flag}>
        <input type="checkbox" checked={flags?.includes(flag) ?? false} disabled={saving}
          onChange={() => void toggle(flag)} />
        <span>{WORKOUT_EXERCISE_QUALITY_FLAG_LABELS[flag]}</span>
      </label>)}
    </div>}
  </div>;
}
