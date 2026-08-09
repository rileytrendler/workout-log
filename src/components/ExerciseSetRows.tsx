import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  deleteWorkoutSet,
  addMyoSet,
  deleteMyoSet,
  getMyoSets,
  updateMyoSet,
  getExerciseComparisons,
  getWorkoutExerciseContext,
  saveSetPerformance,
  updateActualLastSetIntensityTechnique,
  updateLongLengthPartialReps,
  updateSetNote,
  type PriorExercisePerformance,
  type PriorSetReference
} from "../data/workoutRepository";
import type {
  ExerciseMeasurementType,
  LastSetIntensityTechnique,
  WorkoutExercise,
  WorkoutSet,
  WorkoutSetMyoSet
} from "../db/types";
import { LAST_SET_INTENSITY_LABELS, LAST_SET_INTENSITY_TECHNIQUES } from "../utils/intensityTechniques";
import { formatSetPerformance } from "../utils/setFormatting";
import { encodeRepResult, findFinalWorkingSet, getEffectiveReps } from "../utils/failureSemantics";
import type { PersonalRecordStatus } from "../utils/personalRecords";
import { PersonalRecordBadge } from "./PersonalRecordBadge";

type ExerciseSetRowsProps = {
  workoutExerciseId: number;
  currentSets: WorkoutSet[];
  plannedSetCount?: number;
  onWorkingSetCreated?: (setId: number, setNumber: number) => void;
  personalRecordStatuses?: ReadonlyMap<number, PersonalRecordStatus>;
};

type SetDraft = {
  weight: string;
  reps: string;
  actualRpe: string;
  failed: boolean;
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
  unit = "",
  pluralUnit = unit
) {
  if (
    current === undefined ||
    previous === undefined
  ) {
    return null;
  }

  const delta = current - previous;
  const displayedUnit = Math.abs(delta) <= 1 ? unit : pluralUnit;

  if (delta > 0) {
    return (
      <span className="compare-up">
        +{delta}{displayedUnit}
      </span>
    );
  }

  if (delta < 0) {
    return (
      <span className="compare-down">
        {delta}{displayedUnit}
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

export function ExerciseSetRows({
  workoutExerciseId,
  currentSets,
  plannedSetCount,
  onWorkingSetCreated,
  personalRecordStatuses
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
        reps: (currentSet?.failedOnRep ?? currentSet?.reps)?.toString() ?? "",
        actualRpe:
          currentSet?.actualRpe?.toString() ?? "",
        failed: currentSet?.failedOnRep !== undefined
      }
    );
  }

  async function savePerformanceIfReady(
    setNumber: number,
    overrideDraft?: SetDraft
  ) {
    const draft = overrideDraft ?? getDraft(setNumber);

    const enteredReps = Number(draft.reps);

    if (
      !draft.reps ||
      Number.isNaN(enteredReps) || !Number.isInteger(enteredReps) || enteredReps < 1
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

    const actualRpe = draft.failed ? 10 :
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

    const existingSet = getCurrentSet(setNumber);
    const previousFinalSet = [...currentSets]
      .filter((set) => set.isWarmup !== true)
      .sort((a, b) => b.setNumber - a.setNumber)[0];
    if (!existingSet && previousFinalSet && setNumber > previousFinalSet.setNumber &&
      context?.workoutExercise.actualLastSetIntensityTechnique) {
      const technique = LAST_SET_INTENSITY_LABELS[context.workoutExercise.actualLastSetIntensityTechnique];
      if (!confirm(`Adding Set ${setNumber} will make it the final set. Existing ${technique} details on Set ${previousFinalSet.setNumber} will be removed.`)) {
        return;
      }
    }

    const repResult = encodeRepResult(enteredReps, draft.failed);
    let result: Awaited<ReturnType<typeof saveSetPerformance>>;
    try {
      result = await saveSetPerformance(
        workoutExerciseId,
        setNumber,
        {
          weight,
          ...repResult,
          actualRpe
        }
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : "Set could not be saved.");
      return;
    }

    if (result.created) {
      onWorkingSetCreated?.(result.setId, setNumber);
    }
  }

  function updateDraft(
    setNumber: number,
    field: keyof SetDraft,
    value: string | boolean
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
  const finalWorkingSet = findFinalWorkingSet(currentSets);

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
              <strong>Set {setNumber}<PersonalRecordBadge status={currentSet?.id === undefined
                ? undefined : personalRecordStatuses?.get(currentSet.id)} /></strong>

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

              <button type="button" aria-pressed={draft.failed} aria-label={`Set ${setNumber} failed rep`}
                className={`failure-toggle ${draft.failed ? "active" : ""}`}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (draft.failed && currentSet?.id === finalWorkingSet?.id && context?.workoutExercise.actualLastSetIntensityTechnique &&
                    !confirm(`Removing F will clear ${LAST_SET_INTENSITY_LABELS[context.workoutExercise.actualLastSetIntensityTechnique]} details from this final set. Continue?`)) return;
                  const nextDraft = { ...draft, failed: !draft.failed,
                    actualRpe: !draft.failed ? "10" : draft.actualRpe };
                  setDrafts(current => ({ ...current, [setNumber]: nextDraft }));
                  void savePerformanceIfReady(setNumber, nextDraft);
                }}>F</button>

              <input
                inputMode="decimal"
                value={draft.actualRpe}
                disabled={draft.failed}
                aria-label={draft.failed ? "RPE locked at 10 for failed set" : "RPE"}
                title={draft.failed ? "Failed sets are locked at RPE 10" : undefined}
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
                        {formatSetPerformance(reference.set, measurementType)}
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
                            getEffectiveReps(currentSet),
                            getEffectiveReps(previousSet),
                            " rep",
                            " reps"
                          )}
                        </span>
                      )}

                    {currentSet &&
                      previousSet &&
                      measurementType ===
                        "reps_only" && (
                        <span className="compact-comparison">
                          {compareNumber(
                            getEffectiveReps(currentSet),
                            getEffectiveReps(previousSet),
                            " rep",
                            " reps"
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

      {finalWorkingSet && context?.workoutExercise &&
        <ActualTechniqueEditor workoutExercise={context.workoutExercise} finalWorkingSet={finalWorkingSet} />}
    </div>
  );
}

export function ActualTechniqueEditor({ workoutExercise, finalWorkingSet }: {
  workoutExercise: WorkoutExercise & { id?: number };
  finalWorkingSet: WorkoutSet;
}) {
  const workoutExerciseId = workoutExercise.id;
  if (!workoutExerciseId) return null;
  const canRecord = finalWorkingSet.actualRpe === 10 && finalWorkingSet.failedOnRep !== undefined;

  async function changeTechnique(technique?: LastSetIntensityTechnique) {
    const existingMyoRows = finalWorkingSet.id ? await getMyoSets(finalWorkingSet.id) : [];
    if (workoutExercise.actualLastSetIntensityTechnique === "myo_reps" && technique !== "myo_reps" && existingMyoRows.length &&
      !confirm("Changing away from Myo-reps will delete its mini-sets. Continue?")) return;
    try {
      await updateActualLastSetIntensityTechnique(
        workoutExerciseId!,
        technique,
        technique === "failure_llps" ? (workoutExercise.longLengthPartialReps ?? 1) : undefined
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : "Actual technique could not be updated.");
    }
  }

  return <div className="actual-technique-editor">
    <label className="field-label actual-technique-field">
      Actual technique · Set {finalWorkingSet.setNumber}
      <select value={workoutExercise.actualLastSetIntensityTechnique ?? ""} disabled={!canRecord}
        onChange={(event) => void changeTechnique((event.target.value || undefined) as LastSetIntensityTechnique | undefined)}>
        <option value="">{canRecord ? "Not recorded" : "N/A — requires F and RPE 10"}</option>
        {LAST_SET_INTENSITY_TECHNIQUES.map(value =>
          <option key={value} value={value}>{LAST_SET_INTENSITY_LABELS[value]}</option>)}
      </select>
    </label>
    {workoutExercise.actualLastSetIntensityTechnique === "failure_llps" &&
      <LlpInput key={workoutExercise.longLengthPartialReps ?? "empty"}
        workoutExerciseId={workoutExerciseId} count={workoutExercise.longLengthPartialReps} />}
    {finalWorkingSet.id && workoutExercise.actualLastSetIntensityTechnique === "myo_reps" &&
      <MyoSets workoutSetId={finalWorkingSet.id} />}
  </div>;
}

function LlpInput({ workoutExerciseId, count }: { workoutExerciseId: number; count?: number }) {
  const [value, setValue] = useState(count?.toString() ?? "");
  async function save() {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      alert("Enter a positive whole-number LLP count.");
      setValue(count?.toString() ?? "");
      return;
    }
    try { await updateLongLengthPartialReps(workoutExerciseId, parsed); }
    catch (error) { alert(error instanceof Error ? error.message : "LLP count could not be saved."); }
  }
  return <label className="field-label llp-field">Long-length partials
    <input inputMode="numeric" min="1" type="number" value={value}
      onChange={(event) => setValue(event.target.value)} onBlur={() => void save()} />
  </label>;
}

function MyoSets({ workoutSetId }: { workoutSetId: number }) {
  const rows = useLiveQuery(() => getMyoSets(workoutSetId), [workoutSetId]) ?? [];
  const [reps, setReps] = useState("");
  const [failed, setFailed] = useState(false);
  async function add() {
    const value = Number(reps);
    if (!Number.isInteger(value) || value < 1) {
      alert(failed ? "A failed mini-set needs an attempted rep of at least 1." : "Enter at least one completed rep.");
      return;
    }
    try {
      const stored = encodeRepResult(value, failed);
      await addMyoSet(workoutSetId, stored.reps, stored.failedOnRep);
      setReps(""); setFailed(false);
    } catch (error) { alert(error instanceof Error ? error.message : "Myo mini-set could not be added."); }
  }
  return <div className="myo-set-editor"><strong>Myo-rep mini-sets</strong>
    {!rows.length && <span className="muted">Add at least one mini-set.</span>}
    {rows.map(row => <MyoSetRow key={row.id} row={row} />)}
    <div className="myo-set-row myo-add-row"><span className="myo-order">{rows.length + 1}</span>
      <input inputMode="numeric" type="number" min="1" value={reps} onChange={e => setReps(e.target.value)} placeholder="Reps" />
      <button type="button" aria-pressed={failed} className={`failure-toggle ${failed ? "active" : ""}`} onClick={() => setFailed(!failed)}>F</button>
      <button className="secondary-button tiny-button" onClick={() => void add()}>+ Add Myo Set</button></div>
  </div>;
}

function MyoSetRow({ row }: { row: WorkoutSetMyoSet }) {
  const [reps, setReps] = useState(String(row.failedOnRep ?? row.reps));
  const [failed, setFailed] = useState(row.failedOnRep !== undefined);
  async function save(nextFailed = failed) {
    if (!row.id) return;
    const value = Number(reps);
    if (!Number.isInteger(value) || value < 1) return;
    const stored = encodeRepResult(value, nextFailed);
    try { await updateMyoSet(row.id, stored.reps, stored.failedOnRep); }
    catch (error) { alert(error instanceof Error ? error.message : "Myo mini-set could not be saved."); }
  }
  return <div className="myo-set-row"><span className="myo-order">{row.order}</span>
    <input inputMode="numeric" type="number" min="1" value={reps}
      onChange={(event) => setReps(event.target.value)} onBlur={() => void save()} aria-label={`Myo set ${row.order} reps`} />
    <button type="button" aria-pressed={failed} className={`failure-toggle ${failed ? "active" : ""}`}
      onPointerDown={(event) => event.preventDefault()} onClick={() => { const next = !failed; setFailed(next); void save(next); }}>F</button>
    <button className="secondary-button tiny-button danger" onClick={() => row.id && void deleteMyoSet(row.id)}>Delete</button>
  </div>;
}
