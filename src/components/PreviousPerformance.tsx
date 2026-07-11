import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import type { WorkoutSet } from "../db/types";

type PreviousPerformanceProps = {
  workoutExerciseId: number;
  currentSets: WorkoutSet[];
};


function formatSet(set: WorkoutSet) {
  return `${set.weight ?? "?"}×${set.reps ?? "?"}`;
}

function compareNumber(current?: number, previous?: number, unit = "") {
  if (current === undefined || previous === undefined) return null;

  const delta = current - previous;

  if (delta > 0) {
    return <span className="compare-up">+{delta}{unit}</span>;
  }

  if (delta < 0) {
    return <span className="compare-down">{delta}{unit}</span>;
  }

  return <span className="compare-same">same</span>;
}

export function PreviousPerformance({ workoutExerciseId, currentSets }: PreviousPerformanceProps) {
  const [showNotes, setShowNotes] = useState(false);

  const previousPerformance = useLiveQuery(
    async () => {
      const currentWorkoutExercise = await db.workoutExercises.get(workoutExerciseId);

      if (!currentWorkoutExercise) return null;

      const currentWorkout = await db.workouts.get(currentWorkoutExercise.workoutId);

      if (!currentWorkout) return null;

      const allMatchingExerciseRows = await db.workoutExercises
        .where("exerciseId")
        .equals(currentWorkoutExercise.exerciseId)
        .toArray();

      const candidates = [];

      for (const exerciseRow of allMatchingExerciseRows) {
        if (!exerciseRow.id || exerciseRow.workoutId === currentWorkoutExercise.workoutId) continue;

        const candidateWorkout = await db.workouts.get(exerciseRow.workoutId);

        if (!candidateWorkout) continue;

        const candidateSortTime = candidateWorkout.startTime ?? candidateWorkout.createdAt;
        const currentSortTime = currentWorkout.startTime ?? currentWorkout.createdAt;

        if (candidateWorkout.date > currentWorkout.date) continue;
        if (candidateWorkout.date === currentWorkout.date && candidateSortTime >= currentSortTime) continue;

        candidates.push({
          workout: candidateWorkout,
          workoutExercise: exerciseRow,
          sortValue: `${candidateWorkout.date}-${candidateSortTime}`
        });
      }

      candidates.sort((a, b) => b.sortValue.localeCompare(a.sortValue));

      const previous = candidates[0];

      if (!previous?.workoutExercise.id) return null;

      const previousSets = await db.workoutSets
        .where("workoutExerciseId")
        .equals(previous.workoutExercise.id)
        .sortBy("setNumber");

      return {
        workout: previous.workout,
        workoutExercise: previous.workoutExercise,
        sets: previousSets
      };
    },
    [workoutExerciseId]
  );

  if (!previousPerformance) {
    return (
      <div className="previous-performance compact-previous-performance">
        <div className="previous-header">
          <h4>Previous</h4>
          <span className="muted">None found</span>
        </div>
      </div>
    );
  }

  const hasNotes =
    Boolean(previousPerformance.workoutExercise.notes) ||
    previousPerformance.sets.some((set) => Boolean(set.notes));

  return (
    <div className="previous-performance compact-previous-performance">
      <div className="previous-header">
        <h4>Previous</h4>

        <span className="muted">
          {previousPerformance.workout.title || "Untitled"} — {previousPerformance.workout.date}
        </span>

        {hasNotes && (
          <button className="tiny-button" onClick={() => setShowNotes((current) => !current)}>
            {showNotes ? "Hide Notes" : "Show Notes"}
          </button>
        )}
      </div>

      {previousPerformance.sets.length ? (
        <div className="compact-set-list">
          {previousPerformance.sets.map((previousSet) => {
            const currentSet = currentSets.find((set) => set.setNumber === previousSet.setNumber);

            return (
              <div className="compact-set-row" key={previousSet.id}>
                <span className="compact-set-label">Set {previousSet.setNumber}</span>

                <span className="compact-set-values">
                  {formatSet(previousSet)}
                  {currentSet && <> → {formatSet(currentSet)}</>}
                </span>

                {currentSet ? (
                  <span className="compact-comparison">
                    {compareNumber(currentSet.weight, previousSet.weight, " lb")}
                    <span className="comparison-separator">/</span>
                    {compareNumber(currentSet.reps, previousSet.reps, " rep")}
                  </span>
                ) : (
                  <span className="muted">not entered</span>
                )}

                {showNotes && previousSet.notes && (
                  <p className="previous-note compact-note">Set note: {previousSet.notes}</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">No sets recorded.</p>
      )}

      {showNotes && previousPerformance.workoutExercise.notes && (
        <p className="previous-note compact-note">Exercise note: {previousPerformance.workoutExercise.notes}</p>
      )}
    </div>
  );
}