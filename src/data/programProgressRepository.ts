import { db } from "../db/db";
import { buildProgramProgress } from "../utils/programProgress";

/** Batch-loads all record history once, then derives Program analytics in memory. */
export async function getProgramProgress(programId: number) {
  const [program, activeState, weeks, exercises, workouts, workoutExercises, workoutSets] = await Promise.all([
    db.programs.get(programId),
    db.activeProgramStates.where("programId").equals(programId).first(),
    db.programWeeks.where("programId").equals(programId).sortBy("order"),
    db.exercises.toArray(),
    db.workouts.toArray(),
    db.workoutExercises.toArray(),
    db.workoutSets.toArray()
  ]);
  if (!program) return null;
  const weekIds = weeks.flatMap((week) => week.id ?? []);
  const plannedSlots = weekIds.length
    ? await db.programWorkouts.where("programWeekId").anyOf(weekIds).toArray()
    : [];
  return buildProgramProgress({
    program,
    activeState,
    plannedSlots,
    exercises,
    workouts,
    workoutExercises,
    workoutSets
  });
}
