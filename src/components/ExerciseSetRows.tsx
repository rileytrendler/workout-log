import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  deleteWorkoutSet,
  getPreviousPerformance,
  saveSetWeightAndReps,
  updateSetNote
} from "../data/workoutRepository";
import type { WorkoutSet } from "../db/types";

type ExerciseSetRowsProps = {
  workoutExerciseId: number;
  currentSets: WorkoutSet[];
};

type SetDraft = {
  weight: string;
  reps: string;
};

function getSetPerformedTime(set: WorkoutSet) {
  return set.performedAt ?? set.createdAt;
}

function formatTime(value?: string) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function compareNumber(current?: number, previous?: number, unit = "") {
  if (current === undefined || previous === undefined) return null;

  const delta = current - previous;

  if (delta > 0) return <span className="compare-up">+{delta}{unit}</span>;
  if (delta < 0) return <span className="compare-down">{delta}{unit}</span>;

  return <span className="compare-same">same</span>;
}

export function ExerciseSetRows({ workoutExerciseId, currentSets }: ExerciseSetRowsProps) {
  const [drafts, setDrafts] = useState<Record<number, SetDraft>>({});
  const [extraRows, setExtraRows] = useState(0);
  const [editingNoteSetNumber, setEditingNoteSetNumber] = useState<number | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});

const previousPerformance = useLiveQuery(
  () => getPreviousPerformance(workoutExerciseId),
  [workoutExerciseId]
);

  function getCurrentSet(setNumber: number) {
    return currentSets.find((set) => set.setNumber === setNumber);
  }

  function getPreviousSet(setNumber: number) {
    return previousPerformance?.sets.find((set) => set.setNumber === setNumber);
  }

  function getDraft(setNumber: number) {
    const currentSet = getCurrentSet(setNumber);

    return drafts[setNumber] ?? {
      weight: currentSet?.weight?.toString() ?? "",
      reps: currentSet?.reps?.toString() ?? ""
    };
  }

  async function saveWeightRepsIfReady(setNumber: number) {
    const draft = getDraft(setNumber);
    const weight = Number(draft.weight);
    const reps = Number(draft.reps);

    if (
      !draft.weight ||
      !draft.reps ||
      Number.isNaN(weight) ||
      Number.isNaN(reps)
    ) {
      return;
    }

    await saveSetWeightAndReps(
      workoutExerciseId,
      setNumber,
      weight,
      reps
    );
  }

  function updateDraft(setNumber: number, field: "weight" | "reps", value: string) {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [setNumber]: {
        weight: currentDrafts[setNumber]?.weight ?? getCurrentSet(setNumber)?.weight?.toString() ?? "",
        reps: currentDrafts[setNumber]?.reps ?? getCurrentSet(setNumber)?.reps?.toString() ?? "",
        [field]: value
      }
    }));
  }

  function startEditingNote(setNumber: number) {
    const currentSet = getCurrentSet(setNumber);

    if (!currentSet) return;

    setEditingNoteSetNumber(setNumber);
    setNoteDrafts((currentNoteDrafts) => ({
      ...currentNoteDrafts,
      [setNumber]: currentNoteDrafts[setNumber] ?? currentSet.notes ?? ""
    }));
  }

  async function saveNote(setNumber: number) {
    const currentSet = getCurrentSet(setNumber);

    if (!currentSet?.id) return;

    await updateSetNote(
      currentSet.id,
      noteDrafts[setNumber] ?? ""
    );

    setEditingNoteSetNumber(null);
  }

  async function deleteSet(set: WorkoutSet) {
    if (!set.id) return;

    const confirmed = confirm(`Delete Set ${set.setNumber}?`);

    if (!confirmed) return;

    await deleteWorkoutSet(set.id);

    setDrafts((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };
      delete nextDrafts[set.setNumber];
      return nextDrafts;
    });
  }

  const maxExistingSetNumber = Math.max(
    0,
    ...currentSets.map((set) => set.setNumber),
    ...(previousPerformance?.sets.map((set) => set.setNumber) ?? [])
  );

  const rowCount = Math.max(1, maxExistingSetNumber + extraRows);
  const setNumbers = Array.from({ length: rowCount }, (_, index) => index + 1);

  return (
    <div className="set-entry-rows">
      {previousPerformance ? (
        <p className="previous-context">
          Previous: {previousPerformance.workout.title || "Untitled"} — {previousPerformance.workout.date}
        </p>
      ) : (
        <p className="previous-context muted">Previous: none found</p>
      )}

      {setNumbers.map((setNumber) => {
        const currentSet = getCurrentSet(setNumber);
        const previousSet = getPreviousSet(setNumber);
        const draft = getDraft(setNumber);

        return (
          <div className="set-entry-row" key={setNumber}>
            <div className="set-entry-main">
              <strong>Set {setNumber}</strong>

              <input
                inputMode="decimal"
                value={draft.weight}
                onChange={(event) => updateDraft(setNumber, "weight", event.target.value)}
                onBlur={() => saveWeightRepsIfReady(setNumber)}
                placeholder="Weight"
              />

              <input
                inputMode="numeric"
                value={draft.reps}
                onChange={(event) => updateDraft(setNumber, "reps", event.target.value)}
                onBlur={() => saveWeightRepsIfReady(setNumber)}
                placeholder="Reps"
              />

              <div className="previous-inline">
                {previousSet ? (
                  <>
                    Prev {previousSet.weight}×{previousSet.reps}
                    {currentSet && (
                      <span className="compact-comparison">
                        {compareNumber(currentSet.weight, previousSet.weight, " lb")}
                        <span className="comparison-separator">/</span>
                        {compareNumber(currentSet.reps, previousSet.reps, " rep")}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="muted">No previous set</span>
                )}
              </div>

              {currentSet && (
                <div className="button-row set-row-buttons">
                  <button className="secondary-button" onClick={() => startEditingNote(setNumber)}>
                    {currentSet.notes ? "Edit Note" : "Add Note"}
                  </button>

                  <button className="secondary-button" onClick={() => deleteSet(currentSet)}>
                    Delete
                  </button>
                </div>
              )}
            </div>

            {previousSet?.notes && (
              <p className="previous-note compact-note">Previous Note: {previousSet.notes}</p>
            )}

            {currentSet?.notes && editingNoteSetNumber !== setNumber && (
              <p className="set-note compact-note">Current Note: {currentSet.notes}</p>
            )}

            {editingNoteSetNumber === setNumber && currentSet && (
              <div className="note-editor">
                <textarea
                  value={noteDrafts[setNumber] ?? ""}
                  onChange={(event) =>
                    setNoteDrafts((currentNoteDrafts) => ({
                      ...currentNoteDrafts,
                      [setNumber]: event.target.value
                    }))
                  }
                  placeholder="Current set note"
                />

                <div className="button-row">
                  <button className="secondary-button" onClick={() => saveNote(setNumber)}>Save Note</button>
                  <button className="secondary-button" onClick={() => setEditingNoteSetNumber(null)}>Cancel</button>
                </div>
              </div>
            )}

            {currentSet && (
              <p className="muted set-time-line">Logged: {formatTime(getSetPerformedTime(currentSet))}</p>
            )}
          </div>
        );
      })}

      <button className="secondary-button" onClick={() => setExtraRows((current) => current + 1)}>
        + Add Set Row
      </button>
    </div>
  );
}