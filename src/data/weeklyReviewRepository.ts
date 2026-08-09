import { db } from "../db/db";
import { buildWeeklyReview, type WeeklyReview } from "../utils/weeklyReview";

/** Loads one coherent snapshot; review classifications remain derived and are never persisted. */
export async function getWeeklyReview(now: Date = new Date()): Promise<WeeklyReview> {
  const [exercises, workouts, workoutExercises, workoutSets] = await Promise.all([
    db.exercises.toArray(),
    db.workouts.toArray(),
    db.workoutExercises.toArray(),
    db.workoutSets.toArray()
  ]);
  return buildWeeklyReview({ exercises, workouts, workoutExercises, workoutSets }, now);
}
