import { db } from "../db/db";
import type { Exercise, ExerciseLoadEntryMode, ExerciseMeasurementType } from "../db/types";

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
    measurementType: "weight_reps",
    createdAt: nowString(),
    updatedAt: nowString()
  });
}

export async function getUnusedExercises(): Promise<Exercise[]> {
  const exercises = await db.exercises.toArray();
  const [workoutExercises, templateExercises, substitutions, workoutOptions, overrides] = await Promise.all([
    db.workoutExercises.toArray(),
    db.workoutTemplateExercises.toArray(),
    db.workoutTemplateExerciseSubstitutions.toArray(),
    db.workoutExerciseSubstitutionOptions.toArray(),
    db.programWorkoutExerciseOverrides.toArray()
  ]);
  const usedExerciseIds = new Set<number>();
  for (const row of workoutExercises) {
    usedExerciseIds.add(row.exerciseId);
    if (row.prescribedExerciseId !== undefined) usedExerciseIds.add(row.prescribedExerciseId);
  }
  templateExercises.forEach((row) => usedExerciseIds.add(row.exerciseId));
  substitutions.forEach((row) => usedExerciseIds.add(row.substituteExerciseId));
  workoutOptions.forEach((row) => usedExerciseIds.add(row.exerciseId));
  overrides.forEach((row) => usedExerciseIds.add(row.exerciseId));

  return exercises.filter(
    (exercise) =>
      exercise.id !== undefined &&
      !usedExerciseIds.has(exercise.id)
  );
}

export async function deleteExercises(exerciseIds: number[]): Promise<void> {
  if (!exerciseIds.length) return;
  const requested = new Set(exerciseIds);
  const [workoutExercises, templateExercises, substitutions, workoutOptions, overrides] = await Promise.all([
    db.workoutExercises.toArray(), db.workoutTemplateExercises.toArray(),
    db.workoutTemplateExerciseSubstitutions.toArray(), db.workoutExerciseSubstitutionOptions.toArray(),
    db.programWorkoutExerciseOverrides.toArray()
  ]);
  const counts = {
    workouts: workoutExercises.filter((row) => requested.has(row.exerciseId) || (row.prescribedExerciseId !== undefined && requested.has(row.prescribedExerciseId))).length,
    templates: templateExercises.filter((row) => requested.has(row.exerciseId)).length,
    templateSubstitutions: substitutions.filter((row) => requested.has(row.substituteExerciseId)).length,
    workoutOptions: workoutOptions.filter((row) => requested.has(row.exerciseId)).length,
    programOverrides: overrides.filter((row) => requested.has(row.exerciseId)).length
  };
  const references = Object.entries(counts).filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${kind.replace(/([A-Z])/g, " $1").toLowerCase()}`);
  if (references.length) {
    throw new Error(`Exercise deletion is blocked because the selection is referenced by ${references.join(", ")}.`);
  }

  await db.transaction("rw", db.exercises, db.exerciseGymProfiles, async () => {
    await db.exerciseGymProfiles.where("exerciseId").anyOf(exerciseIds).delete();
    await db.exercises.bulkDelete(exerciseIds);
  });
}

export type ExerciseDetailChanges = {
  measurementType: ExerciseMeasurementType;
  loadEntryMode: ExerciseLoadEntryMode;
  setupNotes?: string;
  formCues?: string;
  generalNotes?: string;
  defaultRestSeconds?: number;
};

export async function getExerciseById(
  exerciseId: number
): Promise<Exercise | undefined> {
  return await db.exercises.get(exerciseId);
}

export async function updateExerciseDetails(
  exerciseId: number,
  changes: ExerciseDetailChanges
): Promise<void> {
  await db.exercises.update(exerciseId, {
    measurementType: changes.measurementType,
    loadEntryMode: changes.loadEntryMode,
    setupNotes: changes.setupNotes?.trim() || undefined,
    formCues: changes.formCues?.trim() || undefined,
    generalNotes: changes.generalNotes?.trim() || undefined,
    defaultRestSeconds: changes.defaultRestSeconds,
    updatedAt: nowString()
  });
}
