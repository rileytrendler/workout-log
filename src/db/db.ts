import Dexie, { type Table } from "dexie";
import type { Exercise, Gym, Workout, WorkoutExercise, WorkoutSet } from "./types";

class WorkoutLogDatabase extends Dexie {
  gyms!: Table<Gym, number>;
  exercises!: Table<Exercise, number>;
  workouts!: Table<Workout, number>;
  workoutExercises!: Table<WorkoutExercise, number>;
  workoutSets!: Table<WorkoutSet, number>;

  constructor() {
    super("WorkoutLogDatabase");

    this.version(1).stores({
      gyms: "++id, name, createdAt",
      exercises: "++id, name, category, createdAt",
      workouts: "++id, date, gymId, createdAt, updatedAt",
      workoutExercises: "++id, workoutId, exerciseId, order",
      workoutSets: "++id, workoutExerciseId, setNumber"
    });

    this.version(2).stores({
      gyms: "++id, name, createdAt",
      exercises: "++id, name, category, createdAt",
      workouts: "++id, date, gymId, createdAt, updatedAt",
      workoutExercises: "++id, workoutId, exerciseId, order",
      workoutSets: "++id, workoutExerciseId, setNumber, &[workoutExerciseId+setNumber]"
    });
  }
}

export const db = new WorkoutLogDatabase();