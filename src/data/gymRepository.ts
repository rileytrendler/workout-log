import { db } from "../db/db";
import type { Gym } from "../db/types";

const LAST_GYM_KEY = "workout-log:last-gym-id";

function cleanName(name: string) {
  return name.trim();
}

async function assertUniqueName(name: string, exceptId?: number) {
  const normalized = name.toLocaleLowerCase();
  const gyms = await db.gyms.toArray();
  if (gyms.some((gym) => gym.id !== exceptId && gym.name.trim().toLocaleLowerCase() === normalized)) {
    throw new Error("A gym with that name already exists.");
  }
}

export async function createGym(name: string): Promise<number> {
  const cleaned = cleanName(name);
  if (!cleaned) throw new Error("Gym name cannot be blank.");
  await assertUniqueName(cleaned);
  return db.gyms.add({ name: cleaned, createdAt: new Date().toISOString() });
}

export async function renameGym(gymId: number, name: string): Promise<void> {
  const cleaned = cleanName(name);
  if (!cleaned) throw new Error("Gym name cannot be blank.");
  await assertUniqueName(cleaned, gymId);
  await db.gyms.update(gymId, { name: cleaned });
}

export async function getGymWorkoutCount(gymId: number): Promise<number> {
  return db.workouts.where("gymId").equals(gymId).count();
}

export async function deleteGym(gymId: number): Promise<void> {
  await db.transaction("rw", db.gyms, db.workouts, db.exerciseGymProfiles, async () => {
    const count = await getGymWorkoutCount(gymId);
    if (count) throw new Error(`This gym is used by ${count} workout${count === 1 ? "" : "s"} and cannot be deleted.`);
    await db.exerciseGymProfiles.where("gymId").equals(gymId).delete();
    await db.gyms.delete(gymId);
  });
  if (getStoredLastGymId() === gymId) localStorage.removeItem(LAST_GYM_KEY);
}

export function rememberLastGym(gymId?: number) {
  if (gymId === undefined) localStorage.removeItem(LAST_GYM_KEY);
  else localStorage.setItem(LAST_GYM_KEY, String(gymId));
}

function getStoredLastGymId(): number | undefined {
  const value = localStorage.getItem(LAST_GYM_KEY);
  if (!value) return undefined;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export async function getValidLastGymId(): Promise<number | undefined> {
  const id = getStoredLastGymId();
  if (!id) return undefined;
  if (await db.gyms.get(id)) return id;
  localStorage.removeItem(LAST_GYM_KEY);
  return undefined;
}

export function gymName(gyms: Gym[] | undefined, gymId?: number) {
  if (gymId === undefined) return undefined;
  return gyms?.find((gym) => gym.id === gymId)?.name ?? "Unknown gym";
}
