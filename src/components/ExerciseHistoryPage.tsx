import { lazy, Suspense, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Gym, WorkoutExercise, WorkoutSet } from "../db/types";
import { getExerciseHistory, getMyoSets, type PriorExercisePerformance } from "../data/workoutRepository";
import { ExerciseDetailsPanel } from "./ExerciseDetailsPanel";
import { ExerciseGymProfilePanel } from "./ExerciseGymProfilePanel";
import { formatActualTechniqueDetails, formatSetPerformance } from "../utils/setFormatting";
import { findFinalWorkingSet } from "../utils/failureSemantics";
import type { PersonalRecordStatus } from "../utils/personalRecords";
import { PersonalRecordBadge } from "./PersonalRecordBadge";
import { QualityFlagSummary } from "./WorkoutExerciseQualityFlags";

const ExerciseProgressChart = lazy(() => import("./ExerciseProgressChart")
  .then((module) => ({ default: module.ExerciseProgressChart })));

type Props = {
  exerciseId: number;
  gyms: Gym[];
  initialGymId?: number;
  excludedWorkoutId?: number;
  onBack: () => void;
  onOpenWorkout: (workoutId: number) => void;
  personalRecordStatuses?: ReadonlyMap<number, PersonalRecordStatus>;
};

function measurementLabel(type?: string) {
  return type === "reps_only" ? "Reps only" : type === "bodyweight_added_weight" ? "Bodyweight + added weight" : "Weight + reps";
}

function setText(set: WorkoutSet, type?: string) {
  return formatSetPerformance(set, (type ?? "weight_reps") as "weight_reps" | "reps_only" | "bodyweight_added_weight");
}

function Performance({ title, performance, type }: { title: string; performance?: PriorExercisePerformance; type?: string }) {
  return <div className="history-summary-block"><strong>{title}</strong>{performance ? <>
    <span>{performance.workout.date}{performance.gymName ? ` · ${performance.gymName}` : ""}</span>
    <span>{performance.sets.map((set) => `Set ${set.setNumber}: ${setText(set, type)}`).join(" · ")}</span>
  </> : <span className="muted">None found</span>}</div>;
}

function TechniqueSummary({ workoutExercise, finalSetId }: { workoutExercise: WorkoutExercise; finalSetId?: number }) {
  const rows = useLiveQuery(
    () => finalSetId && workoutExercise.actualLastSetIntensityTechnique === "myo_reps"
      ? getMyoSets(finalSetId) : Promise.resolve([]),
    [finalSetId, workoutExercise.actualLastSetIntensityTechnique]
  ) ?? [];
  const text = formatActualTechniqueDetails(workoutExercise, rows);
  return text ? <p className="set-note">{text}</p> : null;
}

export function ExerciseHistoryPage({ exerciseId, gyms, initialGymId, excludedWorkoutId, onBack, onOpenWorkout, personalRecordStatuses }: Props) {
  const [gymId, setGymId] = useState<number | undefined>(initialGymId);
  const result = useLiveQuery(() => getExerciseHistory(exerciseId, gymId, excludedWorkoutId), [exerciseId, gymId, excludedWorkoutId]);
  if (result === undefined) return <section><button className="secondary-button" onClick={onBack}>Back</button><p>Loading exercise history…</p></section>;
  if (!result) return <section><button className="secondary-button" onClick={onBack}>Back</button><p>This exercise is no longer available.</p></section>;
  const type = result.exercise.measurementType ?? "weight_reps";
  const selectedGym = gymId === undefined ? undefined : gyms.find((gym) => gym.id === gymId);
  const source = (workout: typeof result.sessions[number]["workout"]) =>
    [workout.programNameSnapshot, workout.programCycleNumber ? `Cycle ${workout.programCycleNumber}` : undefined, workout.programWeekLabelSnapshot, workout.programWorkoutNameSnapshot].filter(Boolean).join(" · ");

  return <section className="exercise-history-page">
    <div className="exercise-history-header">
      <div><button className="secondary-button tiny-button" onClick={onBack}>← Back</button><h2>{result.exercise.name}</h2><p className="muted">{measurementLabel(type)}</p></div>
    </div>
    <div className="card"><ExerciseDetailsPanel exerciseId={exerciseId} /></div>
    <label className="field-label exercise-history-filter">Gym
      <select value={gymId ?? ""} onChange={(event) => setGymId(event.target.value ? Number(event.target.value) : undefined)}>
        <option value="">All gyms</option>{gyms.map((gym) => <option key={gym.id} value={gym.id}>{gym.name}</option>)}
      </select>
    </label>
    {gymId === undefined ? <p className="muted">Select a gym to view or edit its saved equipment setup.</p> :
      <ExerciseGymProfilePanel exerciseId={exerciseId} gymId={gymId} gymName={selectedGym?.name ?? "Unknown gym"} />}
    <Suspense fallback={<div className="card"><p className="muted">Loading progress chart…</p></div>}>
      <ExerciseProgressChart key={exerciseId} sessions={result.sessions} measurementType={type}
        unit={result.exercise.defaultUnit} personalRecordStatuses={personalRecordStatuses} />
    </Suspense>
    <div className="exercise-history-summaries">
      <Performance title="Latest anywhere" performance={result.latestAnywhere} type={type} />
      {gymId !== undefined && <Performance title={`Last at ${selectedGym?.name ?? "selected gym"}`} performance={result.lastAtSelectedGym} type={type} />}
      <div className="history-summary-block"><strong>Best by set number</strong>
        {Object.keys(result.bestBySetNumber).length ? Object.entries(result.bestBySetNumber).map(([number, reference]) =>
          <span key={number}>Set {number}: {setText(reference.set, type)} <span className="muted">· {reference.workout.date}</span></span>) : <span className="muted">None found</span>}
      </div>
    </div>
    <h3>Prior sessions</h3>
    {!result.sessions.length ? <div className="card"><p>{gymId === undefined ? "No prior working sets recorded for this exercise." : `No prior working sets recorded at ${selectedGym?.name ?? "this gym"}.`}</p></div> :
      <div className="exercise-history-sessions">{result.sessions.map((session) => {
        const finalSet = findFinalWorkingSet(session.sets);
        return <article className="mini-card exercise-history-session" key={session.workoutExercise.id}>
          <div className="exercise-history-session-heading"><div><strong>{session.workout.date} · {session.workout.title || "Untitled Workout"}</strong>
            <p className="muted">{[session.gymName, source(session.workout), session.workout.status].filter(Boolean).join(" · ")}</p>
            <QualityFlagSummary flags={session.workoutExercise.qualityFlags} /></div>
            {session.workout.id && <button className="secondary-button tiny-button" onClick={() => onOpenWorkout(session.workout.id!)}>Open Workout</button>}</div>
          {session.workoutExercise.notes && <p className="note-block">{session.workoutExercise.notes}</p>}
          {session.workoutExercise.prescribedExerciseId !== undefined &&
            session.workoutExercise.exerciseId !== session.workoutExercise.prescribedExerciseId &&
            session.workoutExercise.prescribedExerciseNameSnapshot &&
            <p className="substitution-note">Substituted for {session.workoutExercise.prescribedExerciseNameSnapshot}</p>}
          <ol className="exercise-history-set-list">{session.sets.map((set) => {
            const status = set.id === undefined ? undefined : personalRecordStatuses?.get(set.id);
            return <li key={set.id}><strong>Set {set.setNumber}</strong><span>{setText(set, type)}
              <PersonalRecordBadge status={status} /></span>
            {set.performedAt && <span className="muted">{new Date(set.performedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
            {set.notes && <p className="set-note">{set.notes}</p>}
            {set.id !== undefined && set.id === finalSet?.id &&
              <TechniqueSummary workoutExercise={session.workoutExercise} finalSetId={set.id} />}</li>})}</ol>
        </article>;
      })}</div>}
  </section>;
}
