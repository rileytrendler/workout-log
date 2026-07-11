import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db/db";
import type { Gym, Workout, WorkoutExercise, WorkoutSet } from "./db/types";
import "./App.css";
import { downloadJsonBackup, downloadSetsCsv, importJsonBackup } from "./utils/backup";
import { ExerciseSetRows } from "./components/ExerciseSetRows";
import { ExerciseAutocomplete } from "./components/ExerciseAutocomplete";
import { ExerciseDetailsPanel } from "./components/ExerciseDetailsPanel";
import { ExerciseGymProfilePanel } from "./components/ExerciseGymProfilePanel";
import { TemplateEditor } from "./components/TemplateEditor";
import { ProgramEditor } from "./components/ProgramEditor";
import { RestTimerBar } from "./components/RestTimerBar";
import { useRestTimer } from "./hooks/useRestTimer";
import {
  deleteExercises,
  getOrCreateExercise,
  getUnusedExercises
} from "./data/exerciseRepository";
import {
  addExerciseToWorkout,
  finishWorkout,
  getActiveWorkout,
  reopenWorkout,
  removeExerciseFromWorkout,
  startBlankWorkout,
  startWorkoutFromTemplate,
  updateHistoricalSet,
  updateSetPerformedTime,
  updateWorkoutExerciseNotes,
  updateWorkoutGym,
  updateWorkoutText
} from "./data/workoutRepository";
import { createGym, deleteGym, getGymWorkoutCount, getValidLastGymId, gymName, rememberLastGym, renameGym } from "./data/gymRepository";
import { getActiveProgramState, getPlannedProgramWorkout, skipPlannedWorkout, startPlannedProgramWorkout } from "./data/programRepository";

function todayString() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function nowString() {
  return new Date().toISOString();
}

function formatDateTime(value?: string) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString();
}

function formatTime(value?: string) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDuration(start?: string, end?: string) {
  if (!start || !end) return "Not finished";

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return "Not finished";

  const totalMinutes = Math.round((endMs - startMs) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes} min`;
  return `${hours} hr ${minutes} min`;
}

function getWorkoutEffectiveEndTime(workout: Workout) {
  return workout.lastSetAt;
}

function getSetPerformedTime(set: WorkoutSet) {
  return set.performedAt ?? set.createdAt;
}

function toDateTimeLocalValue(value?: string) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string) {
  if (!value.trim()) return undefined;
  return new Date(value).toISOString();
}

function programSource(workout?: Workout) {
  return [workout?.programNameSnapshot, workout?.programWeekLabelSnapshot, workout?.programWorkoutNameSnapshot].filter(Boolean).join(" · ");
}

function App() {
  const today = todayString();

  const [page, setPage] = useState<
    "active" | "history" | "templates" | "programs" | "settings"
  >("active");
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<number | null>(null);
  const [fullWorkoutView, setFullWorkoutView] = useState(false);
  const [exerciseName, setExerciseName] = useState("");
  const [newGymName, setNewGymName] = useState("");
  const restTimer = useRestTimer();
  const { timer: activeRestTimer, dismiss: dismissRestTimer } = restTimer;

  const gyms = useLiveQuery<Gym[]>(() => db.gyms.orderBy("name").toArray(), []);

  const workout = useLiveQuery(() => getActiveWorkout(), []);
  const activeProgramState = useLiveQuery(() => getActiveProgramState(), []);
  const plannedProgramWorkout = useLiveQuery(() => getPlannedProgramWorkout(), []);

  const workouts = useLiveQuery(
    async () => (await db.workouts.toArray()).sort((a, b) =>
      (b.startTime ?? b.createdAt).localeCompare(a.startTime ?? a.createdAt) || (b.id ?? 0) - (a.id ?? 0)),
    []
  );

  const selectedWorkout = useLiveQuery<Workout | undefined>(
    async () => {
      if (!selectedWorkoutId) return undefined;
      return await db.workouts.get(selectedWorkoutId);
    },
    [selectedWorkoutId]
  );

  const exercises = useLiveQuery(
    () => db.exercises.orderBy("name").toArray(),
    []
  );

  const templates = useLiveQuery(
    () => db.workoutTemplates.orderBy("name").toArray(),
    []
  );

  const workoutExercises = useLiveQuery<WorkoutExercise[]>(
    async () => {
      if (!workout?.id) return [];
      return await db.workoutExercises.where("workoutId").equals(workout.id).sortBy("order");
    },
    [workout?.id]
  );

  const workoutSets = useLiveQuery<WorkoutSet[]>(
    async () => {
      if (!workoutExercises?.length) return [];

      const workoutExerciseIds = workoutExercises
        .map((workoutExercise) => workoutExercise.id)
        .filter((id): id is number => id !== undefined);

      if (!workoutExerciseIds.length) return [];

      return await db.workoutSets
        .where("workoutExerciseId")
        .anyOf(workoutExerciseIds)
        .toArray();
    },
    [workoutExercises]
  );

  useEffect(() => {
    if (!activeRestTimer || workoutExercises === undefined || workout === undefined) return;
    const associatedExerciseExists = workout?.id === activeRestTimer.workoutId &&
      workoutExercises.some((row) => row.id === activeRestTimer.workoutExerciseId);
    if (!associatedExerciseExists) dismissRestTimer();
  }, [workout, workoutExercises, activeRestTimer, dismissRestTimer]);

  function getRestDuration(workoutExercise: WorkoutExercise) {
    const exercise = exercises?.find((row) => row.id === workoutExercise.exerciseId);
    const duration = workoutExercise.targetRestSeconds ?? exercise?.defaultRestSeconds;
    return duration !== undefined && Number.isFinite(duration) && duration > 0
      ? Math.floor(duration)
      : undefined;
  }

  function startRest(workoutExercise: WorkoutExercise, setId: number, setNumber: number) {
    if (!workout?.id || !workoutExercise.id) return;
    const durationSeconds = getRestDuration(workoutExercise);
    if (!durationSeconds) return;
    restTimer.start({
      workoutId: workout.id,
      workoutExerciseId: workoutExercise.id,
      setId,
      exerciseName: getExerciseName(workoutExercise.exerciseId),
      setNumber,
      durationSeconds
    });
  }

  const selectedWorkoutExercises = useLiveQuery<WorkoutExercise[]>(
    async () => {
      if (!selectedWorkout?.id) return [];
      return await db.workoutExercises.where("workoutId").equals(selectedWorkout.id).sortBy("order");
    },
    [selectedWorkout?.id]
  );

  const selectedWorkoutSets = useLiveQuery<WorkoutSet[]>(
    async () => {
      if (!selectedWorkoutExercises?.length) return [];

      const workoutExerciseIds = selectedWorkoutExercises
        .map((workoutExercise) => workoutExercise.id)
        .filter((id): id is number => id !== undefined);

      if (!workoutExerciseIds.length) return [];

      return await db.workoutSets
        .where("workoutExerciseId")
        .anyOf(workoutExerciseIds)
        .toArray();
    },
    [selectedWorkoutExercises]
  );

  async function removeUnusedExercises() {
    const unusedExercises = await getUnusedExercises();

    if (!unusedExercises.length) {
      alert("No unused exercises found.");
      return;
    }

    const exerciseNames = unusedExercises
      .map((exercise) => `- ${exercise.name}`)
      .join("\n");

    const confirmed = confirm(
      `Remove ${unusedExercises.length} unused exercise(s)?\n\n${exerciseNames}\n\nThis only removes exercises that are not used in any workout history.`
    );

    if (!confirmed) return;

    const unusedExerciseIds = unusedExercises
      .map((exercise) => exercise.id)
      .filter((id): id is number => id !== undefined);

    await deleteExercises(unusedExerciseIds);

    alert(
      `Removed ${unusedExerciseIds.length} unused exercise(s).`
    );
  }

  async function handleImportBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    try {
      await importJsonBackup(file);
      alert("Backup imported successfully.");
      setSelectedWorkoutId(null);
      setFullWorkoutView(false);
      setPage("history");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Backup import failed.");
    } finally {
      event.target.value = "";
    }
  }

  async function recalculateWorkoutLastSetAt(workoutId: number) {
    const exerciseRows = await db.workoutExercises.where("workoutId").equals(workoutId).toArray();

    const workoutExerciseIds = exerciseRows
      .map((exerciseRow) => exerciseRow.id)
      .filter((id): id is number => id !== undefined);

    if (!workoutExerciseIds.length) {
      await db.workouts.update(workoutId, {
        lastSetAt: undefined,
        updatedAt: nowString()
      });

      return;
    }

    const sets = await db.workoutSets
      .where("workoutExerciseId")
      .anyOf(workoutExerciseIds)
      .toArray();

    const latestSetTime = sets
      .map(getSetPerformedTime)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    await db.workouts.update(workoutId, {
      lastSetAt: latestSetTime,
      updatedAt: nowString()
    });
  }

  async function startNewBlankWorkout() {
    try {
      await startBlankWorkout(today, "Workout", await getValidLastGymId());
    } catch (error) {
      alert(error instanceof Error ? error.message : "Workout could not be started.");
    }
  }

  async function startPlannedWorkout() {
    try { await startPlannedProgramWorkout(today, await getValidLastGymId()); }
    catch (error) { alert(error instanceof Error ? error.message : "Planned workout could not be started."); }
  }

  async function skipPlanned() {
    if (!confirm("Skip this planned workout? No Workout or History entry will be created.")) return;
    try { const result = await skipPlannedWorkout(); if (result === "completed") alert("Program complete."); else if (result === "mismatch") alert("Program progress could not be advanced because its definition changed."); }
    catch (error) { alert(error instanceof Error ? error.message : "Planned workout could not be skipped."); }
  }

  async function startOrAddFromTemplate(templateId: number, templateName: string) {
    if (workout) {
      const confirmed = confirm(
        `Add template “${templateName}” to the active workout? Exercises already in the workout will be skipped.`
      );

      if (!confirmed) return;
    }

    try {
      const result = await startWorkoutFromTemplate(today, templateId, await getValidLastGymId());

      if (result.skippedExerciseNames.length) {
        alert(
          `Added ${result.addedExerciseCount} exercise(s). Skipped existing exercise(s):\n- ${result.skippedExerciseNames.join("\n- ")}`
        );
      } else if (!result.createdWorkout) {
        alert(`Added ${result.addedExerciseCount} exercise(s) from “${templateName}”.`);
      }
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "The workout template could not be added."
      );
    }
  }

  function renderPrescriptionSummary(workoutExercise: WorkoutExercise) {
    const items: string[] = [];

    if (workoutExercise.plannedSetCount !== undefined) {
      items.push(`${workoutExercise.plannedSetCount} working set${workoutExercise.plannedSetCount === 1 ? "" : "s"}`);
    }

    if (workoutExercise.targetMinReps !== undefined || workoutExercise.targetMaxReps !== undefined) {
      const reps = workoutExercise.targetMinReps === workoutExercise.targetMaxReps
        ? `${workoutExercise.targetMinReps}`
        : `${workoutExercise.targetMinReps ?? "?"}–${workoutExercise.targetMaxReps ?? "?"}`;
      items.push(`${reps} reps`);
    }

    if (workoutExercise.targetRpeMin !== undefined || workoutExercise.targetRpeMax !== undefined) {
      const rpe = workoutExercise.targetRpeMin === workoutExercise.targetRpeMax
        ? `${workoutExercise.targetRpeMin}`
        : `${workoutExercise.targetRpeMin ?? "?"}–${workoutExercise.targetRpeMax ?? "?"}`;
      items.push(`RPE ${rpe}`);
    }

    if (workoutExercise.targetRestSeconds !== undefined) {
      items.push(`${workoutExercise.targetRestSeconds}s rest`);
    }

    const hasText = workoutExercise.warmupInstructions || workoutExercise.prescriptionNotes;
    if (!items.length && !hasText) return null;

    return (
      <div className="prescription-summary">
        {items.length > 0 && <p>{items.join(" · ")}</p>}
        {workoutExercise.warmupInstructions && (
          <p><strong>Warmup:</strong> {workoutExercise.warmupInstructions}</p>
        )}
        {workoutExercise.prescriptionNotes && (
          <p><strong>Prescription:</strong> {workoutExercise.prescriptionNotes}</p>
        )}
      </div>
    );
  }

  async function updateWorkoutTitle(title: string) {
    if (!workout?.id) return;

    await updateWorkoutText(workout.id, {
      title
    });
  }

  async function updateWorkoutNotes(notes: string) {
    if (!workout?.id) return;

    await updateWorkoutText(workout.id, {
      notes
    });
  }

  async function handleWorkoutExerciseNotesChange(
    workoutExerciseId: number,
    notes: string
  ) {
    await updateWorkoutExerciseNotes(
      workoutExerciseId,
      notes
    );
  }

  async function addExercise(event: React.FormEvent) {
    event.preventDefault();

    const trimmedName = exerciseName.trim();

    if (!trimmedName) return;

    try {
      const exerciseId = await getOrCreateExercise(trimmedName);
      const currentWorkout = await getActiveWorkout();

      if (!currentWorkout?.id) {
        throw new Error("Start a workout before adding an exercise.");
      }

      await addExerciseToWorkout(
        currentWorkout.id,
        exerciseId
      );

      setExerciseName("");
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Exercise could not be added."
      );
    }
  }

  async function editSet(set: WorkoutSet) {
    if (!set.id) return;

    const weightText = prompt("Correct weight:", set.weight?.toString() ?? "");
    if (weightText === null) return;

    const repsText = prompt("Correct reps:", set.reps?.toString() ?? "");
    if (repsText === null) return;

    const notesText = prompt("Correct set notes:", set.notes ?? "");
    if (notesText === null) return;

    const rpeText = prompt("Correct RPE (0–10, decimals allowed; leave blank to clear):", set.actualRpe?.toString() ?? "");
    if (rpeText === null) return;

    const weight = Number(weightText);
    const reps = Number(repsText);
    const trimmedRpe = rpeText.trim();
    const actualRpe = trimmedRpe === "" ? undefined : Number(trimmedRpe);

    if (!weightText || !repsText || Number.isNaN(weight) || Number.isNaN(reps)) {
      alert("Weight and reps must be numbers.");
      return;
    }

    if (
      actualRpe !== undefined &&
      (!Number.isFinite(actualRpe) || actualRpe < 0 || actualRpe > 10)
    ) {
      alert("RPE must be a number between 0 and 10, inclusive, or left blank.");
      return;
    }

    await updateHistoricalSet(set.id, {
      weight,
      reps,
      actualRpe,
      notes: notesText.trim() || undefined,
    });
  }

  async function editSetPerformedTime(set: WorkoutSet) {
    if (!set.id) return;

    const currentValue = toDateTimeLocalValue(getSetPerformedTime(set));
    const newValue = prompt("Set performed time. Use format YYYY-MM-DDTHH:mm", currentValue);

    if (newValue === null) return;

    const performedAt = fromDateTimeLocalValue(newValue);

    await updateSetPerformedTime(set.id, performedAt);
  }

  async function editWorkoutTiming(workoutToEdit: Workout) {
    if (!workoutToEdit.id) return;

    const date = prompt("Workout date, format YYYY-MM-DD:", workoutToEdit.date);
    if (date === null) return;

    const startTime = prompt("Start time, format YYYY-MM-DDTHH:mm:", toDateTimeLocalValue(workoutToEdit.startTime ?? workoutToEdit.createdAt));
    if (startTime === null) return;

    const endTime = prompt("End time, format YYYY-MM-DDTHH:mm. Leave blank if not manually finished:", toDateTimeLocalValue(workoutToEdit.endTime));
    if (endTime === null) return;

    await db.workouts.update(workoutToEdit.id, {
      date: date.trim() || workoutToEdit.date,
      startTime: fromDateTimeLocalValue(startTime),
      endTime: fromDateTimeLocalValue(endTime),
      updatedAt: nowString()
    });
  }

  async function editHistoricalWorkoutText(workoutToEdit: Workout) {
    if (!workoutToEdit.id) return;

    const title = prompt("Workout name:", workoutToEdit.title ?? "");
    if (title === null) return;

    const notes = prompt("Workout notes:", workoutToEdit.notes ?? "");
    if (notes === null) return;

    await db.workouts.update(workoutToEdit.id, {
      title: title.trim() || undefined,
      notes: notes.trim() || undefined,
      updatedAt: nowString()
    });
  }

  async function deleteSet(set: WorkoutSet) {
    if (!set.id) return;

    const workoutExercise = await db.workoutExercises.get(set.workoutExerciseId);

    await db.workoutSets.delete(set.id);

    if (workoutExercise?.workoutId) {
      await recalculateWorkoutLastSetAt(workoutExercise.workoutId);
    }
  }

  async function deleteWorkoutExercise(
    workoutExerciseId: number
  ) {
    const confirmed = confirm(
      "Remove this exercise and all of its sets from this workout?"
    );

    if (!confirmed) return;

    await removeExerciseFromWorkout(workoutExerciseId);
  }


  function getExerciseName(exerciseId: number) {
    return exercises?.find((exercise) => exercise.id === exerciseId)?.name ?? "Unknown Exercise";
  }

  async function changeWorkoutGym(workoutId: number, value: string, remember: boolean) {
    const gymId = value ? Number(value) : undefined;
    await updateWorkoutGym(workoutId, gymId);
    if (remember) rememberLastGym(gymId);
  }

  async function addGym(event: React.FormEvent) {
    event.preventDefault();
    try { await createGym(newGymName); setNewGymName(""); }
    catch (error) { alert(error instanceof Error ? error.message : "Gym could not be created."); }
  }

  async function editGym(gym: Gym) {
    if (!gym.id) return;
    const name = prompt("Gym name:", gym.name);
    if (name === null) return;
    try { await renameGym(gym.id, name); }
    catch (error) { alert(error instanceof Error ? error.message : "Gym could not be renamed."); }
  }

  async function removeGym(gym: Gym) {
    if (!gym.id) return;
    const count = await getGymWorkoutCount(gym.id);
    if (count) { alert(`“${gym.name}” is used by ${count} workout${count === 1 ? "" : "s"} and cannot be deleted.`); return; }
    if (!confirm(`Delete unused gym “${gym.name}”?`)) return;
    await deleteGym(gym.id);
  }

  function getSetsForWorkoutExercise(workoutExerciseId: number, sets = workoutSets) {
    return sets
      ?.filter((set) => set.workoutExerciseId === workoutExerciseId)
      .sort((a, b) => a.setNumber - b.setNumber) ?? [];
  }

  function selectWorkout(workoutId?: number) {
    setSelectedWorkoutId(workoutId ?? null);
    setFullWorkoutView(false);
  }

  async function handleFinishWorkout() {
    if (!workout?.id) return;
    const hasCompletedSets = workoutSets?.some((set) => set.performedAt || set.createdAt) ?? false;
    const message = workout.programId
      ? "Finish this workout and advance to the next planned Program workout?"
      : hasCompletedSets ? "Finish this workout? It will move to History." : "Finish this workout with no completed sets? It will move to History.";
    if (!confirm(message)) return;
    try {
      const result = await finishWorkout(workout.id);
      if (result.programProgress === "mismatch") alert("Workout finished, but Program progress was not advanced because the active Program no longer matched this workout.");
      else if (result.programProgress === "completed") alert("Workout finished. Program complete.");
      restTimer.dismiss();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Workout could not be finished.");
    }
  }

  async function handleReopenWorkout(workoutToReopen: Workout) {
    if (!workoutToReopen.id || !confirm("Reopen this workout as the active workout?")) return;
    try {
      await reopenWorkout(workoutToReopen.id);
      restTimer.dismiss();
      setPage("active");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Workout could not be reopened.");
    }
  }

  function renderSetLine(set: WorkoutSet, showFullDetails: boolean) {
    return (
      <>
        <strong>Set {set.setNumber}:</strong> {set.weight} lb × {set.reps}
        {set.actualRpe !== undefined && <> · RPE {set.actualRpe}</>}
        {showFullDetails && <> <span className="muted">({formatTime(getSetPerformedTime(set))})</span></>}
        {showFullDetails && set.notes && <p className="set-note">{set.notes}</p>}
      </>
    );
  }

  return (
    <main className="app">
      <h1>Workout Log</h1>

      <nav className="tabs">
        <button
          className={
            page === "active" ? "active-tab" : ""
          }
          onClick={() => setPage("active")}
        >
          Active
        </button>

        <button
          className={
            page === "history" ? "active-tab" : ""
          }
          onClick={() => setPage("history")}
        >
          History
        </button>

        <button
          className={
            page === "templates" ? "active-tab" : ""
          }
          onClick={() => setPage("templates")}
        >
          Templates
        </button>

        <button
          className={page === "programs" ? "active-tab" : ""}
          onClick={() => setPage("programs")}
        >
          Programs
        </button>

        <button
          className={
            page === "settings" ? "active-tab" : ""
          }
          onClick={() => setPage("settings")}
        >
          Settings
        </button>
      </nav>

      {page === "active" && (
        <>
          {restTimer.timer && (
            <RestTimerBar
              timer={restTimer.timer}
              onPause={restTimer.pause}
              onResume={restTimer.resume}
              onReset={restTimer.reset}
              onAdjust={restTimer.adjust}
              onDismiss={restTimer.dismiss}
            />
          )}
          {!workout && activeProgramState && (plannedProgramWorkout ? (
            <section className="card planned-workout-card">
              <span className="active-badge">Planned Workout</span>
              <h2>{plannedProgramWorkout.program.name}</h2>
              <p><strong>{plannedProgramWorkout.week.name || `Week ${plannedProgramWorkout.week.order}`} · {plannedProgramWorkout.workout.displayName || plannedProgramWorkout.template.name}</strong></p>
              <p className="muted">Template: {plannedProgramWorkout.template.name} · Workout {plannedProgramWorkout.workoutIndex} of {plannedProgramWorkout.workoutCount}</p>
              {plannedProgramWorkout.workout.notes && <p className="note-block">{plannedProgramWorkout.workout.notes}</p>}
              <div className="button-row"><button onClick={startPlannedWorkout}>Start Planned Workout</button><button className="secondary-button" onClick={() => setPage("programs")}>View Program</button><button className="secondary-button danger" onClick={skipPlanned}>Skip Planned Workout</button></div>
            </section>
          ) : <section className="card planned-workout-card"><h2>Active Program needs attention</h2><p className="muted">Its current week, workout slot, or template is missing.</p><button className="secondary-button" onClick={() => setPage("programs")}>View Program</button></section>)}
          <section className="card">
            <div className="active-workout-heading">
              <div><h2>Active Workout</h2>{workout && <span className="active-badge">Active</span>}</div>
              {workout?.id && <button onClick={handleFinishWorkout}>Finish Workout</button>}
            </div>

            {workout ? (
              <>
                {programSource(workout) && <p className="program-source"><strong>Program:</strong> {programSource(workout)}</p>}
                {!workout.programId && activeProgramState && <p className="muted pending-program-note">A Program workout is still pending and will not advance when this unrelated workout is finished.</p>}
                <label className="field-label">
                  Workout Name
                  <input
                    value={workout.title ?? ""}
                    onChange={(event) => updateWorkoutTitle(event.target.value)}
                    placeholder="Push, Pull, Legs, Upper, etc."
                  />
                </label>

                <label className="field-label compact-gym-field">
                  Gym
                  <select value={workout.gymId ?? ""} onChange={(event) => workout.id && changeWorkoutGym(workout.id, event.target.value, true)}>
                    <option value="">No gym</option>
                    {gyms?.map((gym) => <option key={gym.id} value={gym.id}>{gym.name}</option>)}
                  </select>
                </label>

                <label className="field-label">
                  Workout Notes
                  <textarea
                    value={workout.notes ?? ""}
                    onChange={(event) => updateWorkoutNotes(event.target.value)}
                    placeholder="Energy, soreness, gym conditions, sleep, anything relevant..."
                  />
                </label>

                <p className="success">Workout started at {formatTime(workout.startTime ?? workout.createdAt)}.</p>
                <p>Date: {workout.date} · Started: {formatDateTime(workout.startTime ?? workout.createdAt)}</p>
                <p>Duration: {formatDuration(workout.startTime ?? workout.createdAt, getWorkoutEffectiveEndTime(workout))}</p>

                <button className="secondary-button" onClick={() => editWorkoutTiming(workout)}>Edit Date/Timing</button>

                <p>Workout end is based on the most recently added set.</p>
              </>
            ) : (
              <div className="empty-active-state"><p><strong>No active workout</strong></p><button onClick={startNewBlankWorkout}>Start Blank Workout</button></div>
            )}

          </section>

          <section className="card start-template-card">
            <h2>Start From Template</h2>

            {templates?.length ? (
              <div className="template-start-list">
                {templates.map((template) => (
                  <button
                    type="button"
                    className="template-start-button"
                    key={template.id}
                    disabled={!template.id}
                    onClick={() => template.id && startOrAddFromTemplate(template.id, template.name)}
                  >
                    <strong>{template.name}</strong>
                    {template.notes && <span>{template.notes}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">No saved workout templates yet. Create one on the Templates page.</p>
            )}
          </section>

          <section>
            <h2>Active Workout Exercises</h2>

            {workoutExercises?.length ? (
              <div className="exercise-list">
                {workoutExercises.map((workoutExercise) => {
                  const workoutExerciseId = workoutExercise.id;
                  const sets = workoutExerciseId !== undefined
                    ? getSetsForWorkoutExercise(workoutExerciseId)
                    : [];
                  const restDuration = getRestDuration(workoutExercise);
                  const latestSet = [...sets].sort((a, b) => b.setNumber - a.setNumber)[0];

                  return (
                    <div className="card" key={workoutExercise.id}>
                      <div className="exercise-header">
                        <div>
                          <h3>
                            {getExerciseName(
                              workoutExercise.exerciseId
                            )}
                          </h3>

                          <p className="muted">
                            Started:{" "}
                            {formatTime(
                              workoutExercise.startedAt
                            )}
                          </p>
                        </div>

                        {workoutExerciseId !== undefined && (
                          <button
                            className="danger secondary-button"
                            onClick={() =>
                              deleteWorkoutExercise(
                                workoutExerciseId
                              )
                            }
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <ExerciseDetailsPanel
                        exerciseId={
                          workoutExercise.exerciseId
                        }
                      />

                      {restDuration && workoutExerciseId !== undefined && (
                        <button
                          type="button"
                          className="secondary-button tiny-button start-rest-button"
                          onClick={() => startRest(workoutExercise, latestSet?.id ?? -1, latestSet?.setNumber ?? 1)}
                        >
                          Start Rest · {Math.floor(restDuration / 60)}:{(restDuration % 60).toString().padStart(2, "0")}
                        </button>
                      )}

                      <ExerciseGymProfilePanel
                        exerciseId={workoutExercise.exerciseId}
                        gymId={workout?.gymId}
                        gymName={gymName(gyms, workout?.gymId)}
                      />

                      {renderPrescriptionSummary(workoutExercise)}

                      {workoutExerciseId !== undefined && (
                        <label className="field-label">
                          Exercise Notes
                          <textarea
                            value={
                              workoutExercise.notes ?? ""
                            }
                            onChange={(event) =>
                              handleWorkoutExerciseNotesChange(
                                workoutExerciseId,
                                event.target.value
                              )
                            }
                            placeholder="Notes specific to this performance, setup changes, pain, fatigue..."
                          />
                        </label>
                      )}

                      {workoutExerciseId !== undefined && (
                        <ExerciseSetRows
                          workoutExerciseId={
                            workoutExerciseId
                          }
                          currentSets={sets}
                          plannedSetCount={
                            workoutExercise.plannedSetCount
                          }
                          onWorkingSetCreated={(setId, setNumber) =>
                            startRest(workoutExercise, setId, setNumber)
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p>
                {workout ? "No exercises added to this workout yet." : "Start a workout to add exercises."}
              </p>
            )}
          </section>

          {workout && <section className="card add-exercise-card">
            <h3>Add Exercise</h3>

            <form
              className="inline-form exercise-add-form"
              onSubmit={addExercise}
            >
              <ExerciseAutocomplete
                exercises={exercises ?? []}
                value={exerciseName}
                onChange={setExerciseName}
              />

              <button type="submit">
                Add Exercise
              </button>
            </form>
          </section>}
        </>
      )}

      {page === "history" && (
        <section>
          <h2>Workout History</h2>

          {workouts?.length ? (
            <div className="history-layout">
              <div className="history-list">
                {workouts.map((historyWorkout) => {
                  const effectiveEndTime = getWorkoutEffectiveEndTime(historyWorkout);

                  return (
                    <button
                      className={`history-item ${selectedWorkoutId === historyWorkout.id ? "selected-history-item" : ""}`}
                      key={historyWorkout.id}
                      onClick={() => selectWorkout(historyWorkout.id)}
                    >
                      <strong>{historyWorkout.title || "Untitled Workout"}</strong>
                      <span>{historyWorkout.date}</span>
                      {programSource(historyWorkout) && <span>{programSource(historyWorkout)}</span>}
                      {historyWorkout.gymId !== undefined && <span>{gymName(gyms, historyWorkout.gymId)}</span>}
                      <span>{formatDuration(historyWorkout.startTime ?? historyWorkout.createdAt, effectiveEndTime)}</span>
                    </button>
                  );
                })}
              </div>

              <div className="history-detail card">
                {selectedWorkout ? (
                  <>
                    <div className="history-detail-header">
                      <div>
                        <h3>{selectedWorkout.title || "Untitled Workout"}</h3>
                        <p>{selectedWorkout.date}</p>
                      </div>

                      <div className="button-row">
                        <button onClick={() => setFullWorkoutView((current) => !current)}>
                          {fullWorkoutView ? "Compact View" : "View Full Workout"}
                        </button>
                        <button className="secondary-button" onClick={() => editHistoricalWorkoutText(selectedWorkout)}>Edit Text</button>
                        <button className="secondary-button" onClick={() => editWorkoutTiming(selectedWorkout)}>Edit Date/Timing</button>
                        {selectedWorkout.status !== "active" && <button className="secondary-button" onClick={() => handleReopenWorkout(selectedWorkout)}>Reopen Workout</button>}
                      </div>
                    </div>

                    <p>Started: {formatDateTime(selectedWorkout.startTime ?? selectedWorkout.createdAt)}</p>
                    <p>Last set: {formatDateTime(getWorkoutEffectiveEndTime(selectedWorkout))}</p>
                    <p>Duration: {formatDuration(selectedWorkout.startTime ?? selectedWorkout.createdAt, getWorkoutEffectiveEndTime(selectedWorkout))}</p>
                    <p>Status: {selectedWorkout.status === "active" ? "Active" : "Completed"}</p>
                    {selectedWorkout.completedAt && <p>Completed: {formatDateTime(selectedWorkout.completedAt)}</p>}
                    {programSource(selectedWorkout) && <p><strong>Program source:</strong> {programSource(selectedWorkout)}</p>}
                    {selectedWorkout.gymId !== undefined && <p>Gym: {gymName(gyms, selectedWorkout.gymId)}</p>}

                    <label className="field-label compact-gym-field">
                      Edit Gym
                      <select value={selectedWorkout.gymId ?? ""} onChange={(event) => selectedWorkout.id && changeWorkoutGym(selectedWorkout.id, event.target.value, false)}>
                        <option value="">No gym</option>
                        {gyms?.map((gym) => <option key={gym.id} value={gym.id}>{gym.name}</option>)}
                      </select>
                    </label>

                    {fullWorkoutView && selectedWorkout.notes && (
                      <>
                        <h4>Workout Notes</h4>
                        <p className="note-block">{selectedWorkout.notes}</p>
                      </>
                    )}

                    <h4>Exercises</h4>

                    {selectedWorkoutExercises?.length ? (
                      <div className="exercise-list">
                        {selectedWorkoutExercises.map((historyWorkoutExercise) => {
                          const historyWorkoutExerciseId = historyWorkoutExercise.id;
                          const sets = historyWorkoutExerciseId ? getSetsForWorkoutExercise(historyWorkoutExerciseId, selectedWorkoutSets) : [];

                          return (
                            <div className={fullWorkoutView ? "mini-card full-history-card" : "mini-card"} key={historyWorkoutExercise.id}>
                              <h4>{getExerciseName(historyWorkoutExercise.exerciseId)}</h4>

                              {fullWorkoutView && (
                                <>
                                  <p className="muted">Started: {formatTime(historyWorkoutExercise.startedAt)}</p>
                                  {historyWorkoutExercise.notes && <p className="note-block">{historyWorkoutExercise.notes}</p>}
                                </>
                              )}

                              {sets.length ? (
                                <ol>
                                  {sets.map((set) => (
                                    <li key={set.id} className={fullWorkoutView ? "set-row" : ""}>
                                      <div>
                                        {renderSetLine(set, fullWorkoutView)}
                                      </div>

                                      {fullWorkoutView && (
                                        <div className="button-row">
                                          <button className="secondary-button" onClick={() => editSet(set)}>Edit</button>
                                          <button className="secondary-button" onClick={() => editSetPerformedTime(set)}>Edit Time</button>
                                          <button className="secondary-button danger" onClick={() => deleteSet(set)}>Delete</button>
                                        </div>
                                      )}
                                    </li>
                                  ))}
                                </ol>
                              ) : (
                                <p>No sets recorded.</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p>No exercises recorded.</p>
                    )}
                  </>
                ) : (
                  <p>Select a workout to view details.</p>
                )}
              </div>
            </div>
          ) : (
            <p>No workouts yet.</p>
          )}
        </section>

      )}

      {page === "templates" && (
        <TemplateEditor
          exercises={exercises ?? []}
        />
      )}

      {page === "programs" && (
        <ProgramEditor exercises={exercises ?? []} onViewActive={() => setPage("active")} />
      )}

      {page === "settings" && (
        <section>
          <h2>Settings / Backup</h2>

          <div className="card">
            <h3>Gyms</h3>
            <form className="inline-form" onSubmit={addGym}>
              <input value={newGymName} onChange={(event) => setNewGymName(event.target.value)} placeholder="Add a gym" aria-label="New gym name" />
              <button type="submit">Add</button>
            </form>
            {gyms?.length ? (
              <div className="gym-list">
                {gyms.map((gym) => (
                  <div className="gym-row" key={gym.id}>
                    <span>{gym.name}</span>
                    <div className="button-row">
                      <button type="button" className="secondary-button tiny-button" onClick={() => editGym(gym)}>Rename</button>
                      <button type="button" className="secondary-button danger tiny-button" onClick={() => removeGym(gym)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="muted">No gyms saved.</p>}
          </div>

          <div className="card">
            <h3>Backup</h3>

            <p>
              Export a JSON backup regularly. This protects your workout data if browser storage is cleared or you move to another device.
            </p>

            <div className="button-row">
              <button onClick={downloadJsonBackup}>Export JSON Backup</button>
              <button onClick={downloadSetsCsv}>Export Sets CSV</button>

              <label className="file-import-button">
                Import JSON Backup
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={handleImportBackup}
                />
              </label>
            </div>

            <p className="muted">
              Import replaces all current local workout data with the backup file.
            </p>
          </div>

          <div className="card">
            <h3>Local Data Summary</h3>

            <p>Workouts: {workouts?.length ?? 0}</p>
            <p>Exercises: {exercises?.length ?? 0}</p>
            <p>Gyms: {gyms?.length ?? 0}</p>

            <button className="secondary-button danger" onClick={removeUnusedExercises}>Remove Unused Exercises</button>

            <p className="muted">
              This deletes exercise-library entries that are not used by any workout in your history.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
