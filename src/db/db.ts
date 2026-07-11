import Dexie, { type Table } from "dexie";
import type {
  Exercise,
  Gym,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  WorkoutTemplate,
  WorkoutTemplateExercise
} from "./types";

class WorkoutLogDatabase extends Dexie {
  gyms!: Table<Gym, number>;
  exercises!: Table<Exercise, number>;
  workouts!: Table<Workout, number>;
  workoutExercises!: Table<WorkoutExercise, number>;
  workoutSets!: Table<WorkoutSet, number>;
  workoutTemplates!: Table<WorkoutTemplate, number>;
  workoutTemplateExercises!: Table<WorkoutTemplateExercise, number>;

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

    this.version(3)
      .stores({
        gyms: "++id, name, createdAt",
        exercises: "++id, name, category, createdAt",
        workouts: "++id, date, gymId, createdAt, updatedAt",
        workoutExercises: "++id, workoutId, exerciseId, order",
        workoutSets: "++id, workoutExerciseId, setNumber, &[workoutExerciseId+setNumber]"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("exercises")
          .toCollection()
          .modify((exercise) => {
            if (!exercise.measurementType) {
              exercise.measurementType = "weight_reps";
            }
          });
      });

      this.version(4).stores({
        gyms: "++id, name, createdAt",
        exercises: "++id, name, category, createdAt",
        workouts: "++id, date, gymId, createdAt, updatedAt",
        workoutExercises: "++id, workoutId, exerciseId, order",
        workoutSets: "++id, workoutExerciseId, setNumber, &[workoutExerciseId+setNumber]",
        workoutTemplates: "++id, name, createdAt, updatedAt",
        workoutTemplateExercises: "++id, templateId, exerciseId, order"
      });

  }
}

export const db = new WorkoutLogDatabase();