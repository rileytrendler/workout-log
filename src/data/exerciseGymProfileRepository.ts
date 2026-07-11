import { db } from "../db/db";
import type { ExerciseGymProfile } from "../db/types";

export type ExerciseGymProfileChanges = Pick<
  ExerciseGymProfile,
  "equipmentName" | "setupNotes" | "calibrationNotes"
>;

function clean(value?: string) {
  return value?.trim() || undefined;
}

export async function getExerciseGymProfile(
  exerciseId: number,
  gymId: number
): Promise<ExerciseGymProfile | undefined> {
  return db.exerciseGymProfiles
    .where("[exerciseId+gymId]")
    .equals([exerciseId, gymId])
    .first();
}

export async function upsertExerciseGymProfile(
  exerciseId: number,
  gymId: number,
  changes: ExerciseGymProfileChanges
): Promise<number> {
  return db.transaction(
    "rw",
    db.exercises,
    db.gyms,
    db.exerciseGymProfiles,
    async () => {
      if (!(await db.exercises.get(exerciseId))) {
        throw new Error("Exercise could not be found.");
      }
      if (!(await db.gyms.get(gymId))) {
        throw new Error("Gym could not be found.");
      }

      const existing = await getExerciseGymProfile(exerciseId, gymId);
      const now = new Date().toISOString();
      const values = {
        equipmentName: clean(changes.equipmentName),
        setupNotes: clean(changes.setupNotes),
        calibrationNotes: clean(changes.calibrationNotes),
        updatedAt: now
      };

      if (existing?.id) {
        await db.exerciseGymProfiles.update(existing.id, values);
        return existing.id;
      }

      return db.exerciseGymProfiles.add({
        exerciseId,
        gymId,
        ...values,
        createdAt: now
      });
    }
  );
}

export async function deleteExerciseGymProfile(
  exerciseId: number,
  gymId: number
): Promise<void> {
  await db.exerciseGymProfiles
    .where("[exerciseId+gymId]")
    .equals([exerciseId, gymId])
    .delete();
}

export async function countProfilesForGym(gymId: number): Promise<number> {
  return db.exerciseGymProfiles.where("gymId").equals(gymId).count();
}
