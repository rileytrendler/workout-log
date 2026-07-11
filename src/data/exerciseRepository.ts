import { db } from "../db/db";
import type { Exercise } from "../db/types";

function nowString() {
  return new Date().toISOString();
}

export async function getOrCreateExercise(name: string): Promise<number> {
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("Exercise name is required.");
  }

  const existingExercise = await db.exercises
    .where("name")
    .equalsIgnoreCase(trimmedName)
    .first();

  if (existingExercise?.id) {
    return existingExercise.id;
  }

  return await db.exercises.add({
    name: trimmedName,
    defaultUnit: "lb",
    createdAt: nowString()
  });
}

export async function getUnusedExercises(): Promise<Exercise[]> {
  const exercises = await db.exercises.toArray();
  const workoutExercises = await db.workoutExercises.toArray();

  const usedExerciseIds = new Set(
    workoutExercises.map((workoutExercise) => workoutExercise.exerciseId)
  );

  return exercises.filter(
    (exercise) =>
      exercise.id !== undefined &&
      !usedExerciseIds.has(exercise.id)
  );
}

export async function deleteExercises(exerciseIds: number[]): Promise<void> {
  if (!exerciseIds.length) return;

  await db.exercises.bulkDelete(exerciseIds);
}