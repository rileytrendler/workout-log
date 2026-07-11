import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  deleteWorkoutSet,
  getExerciseComparisons,
  getWorkoutExerciseContext,
  saveSetPerformance,
  updateSetNote,
  type PriorExercisePerformance,
  type PriorSetReference
} from "../data/workoutRepository";
import type {
  ExerciseMeasurementType,
  WorkoutSet
} from "../db/types";

type ExerciseSetRowsProps = {
  workoutExerciseId: number;
  currentSets: WorkoutSet[];
  plannedSetCount?: number;
};

type SetDraft = {
  weight: string;
  reps: string;
  actualRpe: string;
};

function getSetPerformedTime(set: WorkoutSet) {
  return set.performedAt ?? set.createdAt;
}

function formatTime(value?: string) {
  if (!value) return "Not recorded";

  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function compareNumber(
  current?: number,
  previous?: number,
  unit = ""
) {
  if (
    current === undefined ||
    previous === undefined
  ) {
    return null;
  }

  const delta = current - previous;

  if (delta > 0) {
    return (
      <span className="compare-up">
        +{delta}{unit}
      </span>
    );
  }

  if (delta < 0) {
    return (
      <span className="compare-down">
        {delta}{unit}
      </span>
    );
  }

  return <span className="compare-same">same</span>;
}

function usesRequiredWeight(
  measurementType: ExerciseMeasurementType
) {
  return measurementType === "weight_reps";
}

function displaysWeightInput(
  measurementType: ExerciseMeasurementType
) {
  return measurementType !== "reps_only";
}

function weightPlaceholder(
  measurementType: ExerciseMeasurementType
) {
  if (measurementType === "bodyweight_added_weight") {
    return "Added wt";
  }

  return "Weight";
}

function displayWeight(
  set: WorkoutSet,
  measurementType: ExerciseMeasurementType
) {
  if (measurementType === "reps_only") {
    return `${set.reps ?? "?"} reps`;
  }

  if (measurementType === "bodyweight_added_weight") {
    const addedWeight = set.weight ?? 0;

    return addedWeight === 0
      ? `Bodyweight × ${set.reps ?? "?"}`
      : `Bodyweight + ${addedWeight} × ${set.reps ?? "?"}`;
  }

  return `${set.weight ?? "?"}×${set.reps ?? "?"}`;
}

export function ExerciseSetRows({
  workoutExerciseId,
  currentSets,
  plannedSetCount
}: ExerciseSetRowsProps) {
  const [drafts, setDrafts] = useState<
    Record<number, SetDraft>
  >({});
  const [extraRows, setExtraRows] = useState(0);
  const [
    editingNoteSetNumber,
    setEditingNoteSetNumber
  ] = useState<number | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<
    Record<number, string>
  >({});

  const context = useLiveQuery(
    () => getWorkoutExerciseContext(workoutExerciseId),
    [workoutExerciseId]
  );

  const comparisons = useLiveQuery(
    () => getExerciseComparisons(workoutExerciseId),
    [workoutExerciseId]
  );

  const measurementType =
    context?.exercise.measurementType ?? "weight_reps";
  const primaryPerformance =
    comparisons?.lastAtCurrentGym ?? comparisons?.latestAnywhere;

  function getCurrentSet(setNumber: number) {
    return currentSets.find(
      (set) => set.setNumber === setNumber
    );
  }

  function getPreviousSet(setNumber: number) {
    return primaryPerformance?.sets.find(
      (set) => set.setNumber === setNumber
    );
  }

  function getReferenceRows(setNumber: number) {
    const references: Array<{ label: string; reference: PriorSetReference }> = [];
    const addPerformanceSet = (
      label: string,
      performance: PriorExercisePerformance | undefined
    ) => {
      const set = performance?.sets.find((candidate) => candidate.setNumber === setNumber);
      const performedAt = set && getSetPerformedTime(set);
      if (!set || !performedAt || !performance) return;
      references.push({
        label,
        reference: {
          set,
          workout: performance.workout,
          workoutExercise: performance.workoutExercise,
          gymName: performance.gymName,
          performedAt,
          matchedTargetRepRange: false
        }
      });
    };

    addPerformanceSet("Last here", comparisons?.lastAtCurrentGym);
    addPerformanceSet("Latest", comparisons?.latestAnywhere);
    const best = comparisons?.bestBySetNumber[setNumber];
    if (best) references.push({ label: "Best", reference: best });

    const grouped = new Map<string, { labels: string[]; reference: PriorSetReference }>();
    for (const item of references) {
      const setIdentity = item.reference.set.id !== undefined
        ? `set-${item.reference.set.id}`
        : `${item.reference.workout.id}-${item.reference.workoutExercise.id}-${item.reference.set.setNumber}`;
      const existing = grouped.get(setIdentity);
      if (existing) existing.labels.push(item.label);
      else grouped.set(setIdentity, { labels: [item.label], reference: item.reference });
    }
    return [...grouped.values()];
  }

  function getDraft(setNumber: number): SetDraft {
    const currentSet = getCurrentSet(setNumber);

    const storedWeight =
      currentSet?.weight === 0 &&
      measurementType !== "weight_reps"
        ? ""
        : currentSet?.weight?.toString() ?? "";

    return (
      drafts[setNumber] ?? {
        weight: storedWeight,
        reps: currentSet?.reps?.toString() ?? "",
        actualRpe:
          currentSet?.actualRpe?.toString() ?? ""
      }
    );
  }

  async function savePerformanceIfReady(
    setNumber: number
  ) {
    const draft = getDraft(setNumber);

    const reps = Number(draft.reps);

    if (
      !draft.reps ||
      Number.isNaN(reps)
    ) {
      return;
    }

    let weight: number | undefined;

    if (usesRequiredWeight(measurementType)) {
      if (
        !draft.weight ||
        Number.isNaN(Number(draft.weight))
      ) {
        return;
      }

      weight = Number(draft.weight);
    } else if (
      measurementType === "bodyweight_added_weight"
    ) {
      weight =
        draft.weight.trim() === ""
          ? 0
          : Number(draft.weight);

      if (Number.isNaN(weight)) return;
    } else {
      weight = 0;
    }

    const actualRpe =
      draft.actualRpe.trim() === ""
        ? undefined
        : Number(draft.actualRpe);

    if (
      actualRpe !== undefined &&
      (
        Number.isNaN(actualRpe) ||
        actualRpe < 0 ||
        actualRpe > 10
      )
    ) {
      alert("RPE must be between 0 and 10.");
      return;
    }

    await saveSetPerformance(
      workoutExerciseId,
      setNumber,
      {
        weight,
        reps,
        actualRpe
      }
    );
  }

  function updateDraft(
    setNumber: number,
    field: keyof SetDraft,
    value: string
  ) {
    const currentDraft = getDraft(setNumber);

    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [setNumber]: {
        ...currentDraft,
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
      [setNumber]:
        currentNoteDrafts[setNumber] ??
        currentSet.notes ??
        ""
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

    const confirmed = confirm(
      `Delete Set ${set.setNumber}?`
    );

    if (!confirmed) return;

    await deleteWorkoutSet(set.id);

    setDrafts((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };
      delete nextDrafts[set.setNumber];
      return nextDrafts;
    });
  }

  const maxExistingSetNumber = Math.max(0, ...currentSets.map((set) => set.setNumber));

  const rowCount = Math.max(
    1,
    maxExistingSetNumber,
    plannedSetCount ?? 0
  ) + extraRows;

  const setNumbers = Array.from(
    { length: rowCount },
    (_, index) => index + 1
  );

  return (
    <div className="set-entry-rows">
      {!primaryPerformance && !Object.keys(comparisons?.bestBySetNumber ?? {}).length && (
        <p className="previous-context muted">
          Previous: none found
        </p>
      )}

      {setNumbers.map((setNumber) => {
        const currentSet = getCurrentSet(setNumber);
        const previousSet = getPreviousSet(setNumber);
        const referenceRows = getReferenceRows(setNumber);
        const draft = getDraft(setNumber);

        return (
          <div
            className="set-entry-row"
            key={setNumber}
          >
            <div className="set-entry-main">
              <strong>Set {setNumber}</strong>

              {displaysWeightInput(measurementType) && (
                <input
                  inputMode="decimal"
                  value={draft.weight}
                  onChange={(event) =>
                    updateDraft(
                      setNumber,
                      "weight",
                      event.target.value
                    )
                  }
                  onBlur={() =>
                    savePerformanceIfReady(setNumber)
                  }
                  placeholder={weightPlaceholder(
                    measurementType
                  )}
                />
              )}

              <input
                inputMode="numeric"
                value={draft.reps}
                onChange={(event) =>
                  updateDraft(
                    setNumber,
                    "reps",
                    event.target.value
                  )
                }
                onBlur={() =>
                  savePerformanceIfReady(setNumber)
                }
                placeholder="Reps"
              />

              <input
                inputMode="decimal"
                value={draft.actualRpe}
                onChange={(event) =>
                  updateDraft(
                    setNumber,
                    "actualRpe",
                    event.target.value
                  )
                }
                onBlur={() =>
                  savePerformanceIfReady(setNumber)
                }
                placeholder="RPE"
              />

              <div className="previous-inline">
                {referenceRows.length ? (
                  <div className="set-reference-list">
                    {referenceRows.map(({ labels, reference }) => (
                      <div key={reference.set.id ?? `${reference.workout.id}-${setNumber}`}>
                        <strong>{labels.join(" / ")}:</strong>{" "}
                        {displayWeight(reference.set, measurementType)}
                        {reference.set.actualRpe !== undefined && ` @ ${reference.set.actualRpe}`}
                      </div>
                    ))}

                    {currentSet &&
                      previousSet &&
                      measurementType !==
                        "reps_only" && (
                        <span className="compact-comparison">
                          {compareNumber(
                            currentSet.weight,
                            previousSet.weight,
                            " lb"
                          )}
                          <span className="comparison-separator">
                            /
                          </span>
                          {compareNumber(
                            currentSet.reps,
                            previousSet.reps,
                            " rep"
                          )}
                        </span>
                      )}

                    {currentSet &&
                      previousSet &&
                      measurementType ===
                        "reps_only" && (
                        <span className="compact-comparison">
                          {compareNumber(
                            currentSet.reps,
                            previousSet.reps,
                            " rep"
                          )}
                        </span>
                      )}
                  </div>
                ) : (
                  <span className="muted">
                    No previous set
                  </span>
                )}
              </div>

              {currentSet && (
                <div className="button-row set-row-buttons">
                  <button
                    className="secondary-button"
                    onClick={() =>
                      startEditingNote(setNumber)
                    }
                  >
                    {currentSet.notes
                      ? "Edit Note"
                      : "Add Note"}
                  </button>

                  <button
                    className="secondary-button danger"
                    onClick={() =>
                      deleteSet(currentSet)
                    }
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>

            {previousSet?.notes && (
              <p className="previous-note compact-note">
                Previous Note: {previousSet.notes}
              </p>
            )}

            {currentSet?.notes &&
              editingNoteSetNumber !== setNumber && (
                <p className="set-note compact-note">
                  Current Note: {currentSet.notes}
                </p>
              )}

            {editingNoteSetNumber === setNumber &&
              currentSet && (
                <div className="note-editor">
                  <textarea
                    value={
                      noteDrafts[setNumber] ?? ""
                    }
                    onChange={(event) =>
                      setNoteDrafts(
                        (currentNoteDrafts) => ({
                          ...currentNoteDrafts,
                          [setNumber]:
                            event.target.value
                        })
                      )
                    }
                    placeholder="Current set note"
                  />

                  <div className="button-row">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        saveNote(setNumber)
                      }
                    >
                      Save Note
                    </button>

                    <button
                      className="secondary-button"
                      onClick={() =>
                        setEditingNoteSetNumber(null)
                      }
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

            {currentSet && (
              <p className="muted set-time-line">
                Logged:{" "}
                {formatTime(
                  getSetPerformedTime(currentSet)
                )}
              </p>
            )}
          </div>
        );
      })}

      <button
        className="secondary-button"
        onClick={() =>
          setExtraRows((current) => current + 1)
        }
      >
        + Add Set
      </button>
    </div>
  );
}
