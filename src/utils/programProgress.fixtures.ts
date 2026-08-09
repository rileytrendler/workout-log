import type { ActiveProgramState, Exercise, Program, ProgramWorkout, Workout, WorkoutExercise, WorkoutSet } from "../db/types";
import { buildProgramProgress, compareProgramCycles } from "./programProgress";

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Program progress fixture failed: ${message}`);
}

const stamp = (day: number) => `2026-01-${String(day).padStart(2, "0")}T12:00:00.000Z`;
const completedWorkout = (id: number, day: number, programId?: number, cycle?: number, slot?: number): Workout => ({
  id,
  date: `2026-01-${String(day).padStart(2, "0")}`,
  status: "completed",
  programId,
  programCycleNumber: cycle,
  programWorkoutId: slot,
  createdAt: stamp(day),
  updatedAt: stamp(day)
});
const workoutExercise = (id: number, workoutId: number, exerciseId: number, order: number, extra: Partial<WorkoutExercise> = {}): WorkoutExercise => ({
  id, workoutId, exerciseId, order, ...extra
});
const set = (id: number, workoutExerciseId: number, setNumber: number, weight: number | undefined, reps: number, day: number, failedOnRep?: number): WorkoutSet => ({
  id, workoutExerciseId, setNumber, weight, reps, failedOnRep, performedAt: stamp(day), createdAt: stamp(day)
});

export function runProgramProgressFixtures() {
  const program: Program = { id: 1, name: "Fixture Program", endBehavior: "repeat", createdAt: stamp(1), updatedAt: stamp(1) };
  const activeState: ActiveProgramState = { id: 1, programId: 1, currentProgramWeekId: 1, currentProgramWorkoutId: 11, cycleNumber: 2, activatedAt: stamp(1), updatedAt: stamp(3) };
  const plannedSlots: ProgramWorkout[] = [11, 12].map((id, index) => ({
    id, programWeekId: 1, templateId: id, order: index + 1, createdAt: stamp(1), updatedAt: stamp(1)
  }));
  const exercises: Exercise[] = [
    { id: 1, name: "Bench", defaultUnit: "lb", measurementType: "weight_reps", createdAt: stamp(1) },
    { id: 2, name: "Curl", defaultUnit: "lb", measurementType: "weight_reps", createdAt: stamp(1) },
    { id: 3, name: "Lat Pulldown", defaultUnit: "lb", measurementType: "weight_reps", createdAt: stamp(1) },
    { id: 4, name: "Pull-Up", defaultUnit: "lb", measurementType: "reps_only", createdAt: stamp(1) }
  ];
  const workouts: Workout[] = [
    completedWorkout(1, 1, 1, 1, 11),
    completedWorkout(2, 2, 1, 1, 12),
    completedWorkout(3, 3, 1, 2, 11),
    completedWorkout(4, 4, 1, undefined, 11),
    completedWorkout(5, 5, 2, 1, 11),
    completedWorkout(6, 6),
    { ...completedWorkout(7, 7, 1, 2, 12), status: "active" }
  ];
  const workoutExercises: WorkoutExercise[] = [
    workoutExercise(1, 1, 1, 1),
    workoutExercise(2, 1, 2, 2),
    workoutExercise(3, 2, 3, 1),
    workoutExercise(4, 3, 1, 1),
    workoutExercise(5, 3, 2, 2),
    workoutExercise(6, 3, 4, 3, { prescribedExerciseId: 3, prescribedExerciseNameSnapshot: "Lat Pulldown", qualityFlags: ["low_energy"] }),
    workoutExercise(7, 4, 1, 1),
    workoutExercise(8, 5, 1, 1),
    workoutExercise(9, 6, 1, 1),
    workoutExercise(10, 7, 3, 1)
  ];
  const workoutSets: WorkoutSet[] = [
    set(1, 1, 1, 150, 10, 1),
    set(2, 1, 2, 140, 8, 1),
    set(3, 2, 1, 150, 5, 1),
    set(4, 3, 1, 100, 10, 2),
    set(5, 4, 1, 155, 8, 3),
    set(6, 5, 1, 150, 5, 3, 6),
    set(7, 6, 1, undefined, 8, 3),
    set(8, 7, 1, 160, 6, 4),
    set(9, 8, 1, 500, 20, 5),
    set(10, 9, 1, 500, 20, 6),
    set(11, 10, 1, 200, 20, 7)
  ];
  const progress = buildProgramProgress({ program, activeState, plannedSlots, exercises, workouts, workoutExercises, workoutSets });
  const comparison = compareProgramCycles(progress, 1, 2);
  expect(comparison, "cycles 1 and 2 should compare");
  expect(comparison.exercises.find((item) => item.exerciseId === 1)?.state === "improved", "155 × 8 should beat 150 × 10");
  expect(comparison.exercises.find((item) => item.exerciseId === 2)?.state === "improved", "150 × 6f should beat 150 × 5 via 5.5 effective reps");
  expect(comparison.exercises.find((item) => item.exerciseId === 4)?.state === "new", "Pull-Up should be new, not improved versus its prescribed Lat Pulldown");
  expect(comparison.exercises.find((item) => item.exerciseId === 3)?.state === "not_yet_performed", "an in-progress cycle should not mark an unperformed exercise down");
  expect(progress.cycles[0].isComplete, "a later cycle is conservative completion evidence for the prior repeat cycle");
  expect(progress.cycles[1].isInProgress, "the active cycle should be labeled in progress");
  expect(progress.cycles[0].prCount === 3 && progress.cycles[0].setPrCount === 1, "cycle records should use chronological global PR and SET PR-only status");
  expect(progress.cycles[1].prCount === 3 && progress.cycles[1].setPrCount === 0, "later-cycle record events should be attributed to their cycle");
  expect(progress.cycles[1].qualityFlags.low_energy === 1 && progress.cycles[1].qualityExercises.low_energy?.[0] === "Pull-Up", "quality flags should follow the actual substituted exercise");
  expect(progress.summary.workoutCount === 4, "manual, other-Program, and active workouts should be excluded");
  expect(progress.summary.workoutsWithoutCycleProvenance === 1 && progress.cycles.length === 2, "missing cycle provenance should remain total-only without an invented cycle");
}

runProgramProgressFixtures();
