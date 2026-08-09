import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  getExerciseById,
  updateExerciseDetails
} from "../data/exerciseRepository";
import type { ExerciseLoadEntryMode, ExerciseMeasurementType } from "../db/types";

type ExerciseDetailsPanelProps = {
  exerciseId: number;
};

export function ExerciseDetailsPanel({
  exerciseId
}: ExerciseDetailsPanelProps) {
  const exercise = useLiveQuery(
    () => getExerciseById(exerciseId),
    [exerciseId]
  );

  const [isEditing, setIsEditing] = useState(false);
  const [measurementType, setMeasurementType] =
    useState<ExerciseMeasurementType>("weight_reps");
  const [loadEntryMode, setLoadEntryMode] = useState<ExerciseLoadEntryMode>("standard");
  const [setupNotes, setSetupNotes] = useState("");
  const [formCues, setFormCues] = useState("");
  const [generalNotes, setGeneralNotes] = useState("");
  const [defaultRestSeconds, setDefaultRestSeconds] =
    useState("");

  useEffect(() => {
    if (!exercise) return;

    /* eslint-disable react-hooks/set-state-in-effect -- reset the controlled editor when its async Exercise changes */
    setMeasurementType(
      exercise.measurementType ?? "weight_reps"
    );
    setLoadEntryMode(exercise.loadEntryMode ?? "standard");
    setSetupNotes(exercise.setupNotes ?? "");
    setFormCues(exercise.formCues ?? "");
    setGeneralNotes(exercise.generalNotes ?? "");
    setDefaultRestSeconds(
      exercise.defaultRestSeconds?.toString() ?? ""
    );
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [exercise]);

  async function saveDetails() {
    const parsedRestSeconds =
      defaultRestSeconds.trim() === ""
        ? undefined
        : Number(defaultRestSeconds);

    if (
      parsedRestSeconds !== undefined &&
      (
        Number.isNaN(parsedRestSeconds) ||
        parsedRestSeconds < 0
      )
    ) {
      alert("Default rest time must be a valid number.");
      return;
    }

    await updateExerciseDetails(exerciseId, {
      measurementType,
      loadEntryMode,
      setupNotes,
      formCues,
      generalNotes,
      defaultRestSeconds: parsedRestSeconds
    });

    setIsEditing(false);
  }

  if (!exercise) return null;

  if (!isEditing) {
    const hasDetails =
      exercise.setupNotes ||
      exercise.formCues ||
      exercise.generalNotes ||
      exercise.defaultRestSeconds;

    return (
      <div className="exercise-library-details">
        {exercise.setupNotes && (
          <p>
            <strong>Setup:</strong> {exercise.setupNotes}
          </p>
        )}

        {exercise.formCues && (
          <p>
            <strong>Form cues:</strong> {exercise.formCues}
          </p>
        )}

        {exercise.generalNotes && (
          <p>
            <strong>Exercise notes:</strong>{" "}
            {exercise.generalNotes}
          </p>
        )}

        {exercise.defaultRestSeconds !== undefined && (
          <p>
            <strong>Default rest:</strong>{" "}
            {exercise.defaultRestSeconds} seconds
          </p>
        )}

        <p><strong>Load entry:</strong>{" "}
          {loadEntryMode === "paired" ? "Paired dumbbells" : loadEntryMode === "expression" ? "Expression" : "Standard"}
        </p>

        {!hasDetails && (
          <p className="muted">
            No persistent setup or form information.
          </p>
        )}

        <button
          className="secondary-button"
          onClick={() => setIsEditing(true)}
        >
          Edit Exercise Details
        </button>
      </div>
    );
  }

  return (
    <div className="exercise-details-editor">
      <label className="field-label">
        Logging Type
        <select
          value={measurementType}
          onChange={(event) =>
            setMeasurementType(
              event.target.value as ExerciseMeasurementType
            )
          }
        >
          <option value="weight_reps">
            Weight + Reps
          </option>
          <option value="reps_only">
            Reps Only
          </option>
          <option value="bodyweight_added_weight">
            Bodyweight + Added Weight
          </option>
        </select>
      </label>

      <label className="field-label">
        Load Entry
        <select value={loadEntryMode} onChange={(event) => setLoadEntryMode(event.target.value as ExerciseLoadEntryMode)}>
          <option value="standard">Standard</option>
          <option value="paired">Paired / per dumbbell</option>
          <option value="expression">Expression</option>
        </select>
        <small className="muted">
          {loadEntryMode === "paired" ? "Enter the weight of one dumbbell. Example: 90 lb each."
            : loadEntryMode === "expression" ? "Enter a load expression such as 7x45+25."
              : "Enter the weight shown on the machine or bar."}
        </small>
      </label>

      <label className="field-label">
        Machine / Equipment Setup
        <textarea
          value={setupNotes}
          onChange={(event) =>
            setSetupNotes(event.target.value)
          }
          placeholder="Seat height, pin position, attachment, bench setting..."
        />
      </label>

      <label className="field-label">
        Persistent Form Cues
        <textarea
          value={formCues}
          onChange={(event) =>
            setFormCues(event.target.value)
          }
          placeholder="Keep elbows tucked, control eccentric, brace..."
        />
      </label>

      <label className="field-label">
        General Exercise Notes
        <textarea
          value={generalNotes}
          onChange={(event) =>
            setGeneralNotes(event.target.value)
          }
          placeholder="Anything that should follow this exercise across workouts..."
        />
      </label>

      <label className="field-label">
        Default Rest Time in Seconds
        <input
          inputMode="numeric"
          value={defaultRestSeconds}
          onChange={(event) =>
            setDefaultRestSeconds(event.target.value)
          }
          placeholder="Example: 120"
        />
      </label>

      <div className="button-row">
        <button onClick={saveDetails}>
          Save Exercise Details
        </button>

        <button
          className="secondary-button"
          onClick={() => setIsEditing(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
