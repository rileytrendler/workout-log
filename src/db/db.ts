import Dexie, { type Table } from "dexie";
import type {
  Exercise,
  ExerciseGymProfile,
  Gym,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  WorkoutTemplate,
  WorkoutTemplateExercise,
  Program,
  ProgramWeek,
  ProgramWorkout,
  ProgramWorkoutExerciseOverride,
  ActiveProgramState
} from "./types";

class WorkoutLogDatabase extends Dexie {
  gyms!: Table<Gym, number>;
  exercises!: Table<Exercise, number>;
  exerciseGymProfiles!: Table<ExerciseGymProfile, number>;
  workouts!: Table<Workout, number>;
  workoutExercises!: Table<WorkoutExercise, number>;
  workoutSets!: Table<WorkoutSet, number>;
  workoutTemplates!: Table<WorkoutTemplate, number>;
  workoutTemplateExercises!: Table<WorkoutTemplateExercise, number>;
  programs!: Table<Program, number>;
  programWeeks!: Table<ProgramWeek, number>;
  programWorkouts!: Table<ProgramWorkout, number>;
  programWorkoutExerciseOverrides!: Table<ProgramWorkoutExerciseOverride, number>;
  activeProgramStates!: Table<ActiveProgramState, number>;

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

    this.version(5).stores({
      gyms: "++id, name, createdAt",
      exercises: "++id, name, category, createdAt",
      exerciseGymProfiles: "++id, exerciseId, gymId, &[exerciseId+gymId]",
      workouts: "++id, date, gymId, createdAt, updatedAt",
      workoutExercises: "++id, workoutId, exerciseId, order",
      workoutSets: "++id, workoutExerciseId, setNumber, &[workoutExerciseId+setNumber]",
      workoutTemplates: "++id, name, createdAt, updatedAt",
      workoutTemplateExercises: "++id, templateId, exerciseId, order"
    });

    this.version(6).stores({
      gyms: "++id, name, createdAt",
      exercises: "++id, name, category, createdAt",
      exerciseGymProfiles: "++id, exerciseId, gymId, &[exerciseId+gymId]",
      workouts: "++id, date, gymId, createdAt, updatedAt",
      workoutExercises: "++id, workoutId, exerciseId, order",
      workoutSets: "++id, workoutExerciseId, setNumber, &[workoutExerciseId+setNumber]",
      workoutTemplates: "++id, name, createdAt, updatedAt",
      workoutTemplateExercises: "++id, templateId, exerciseId, order",
      programs: "++id, name, createdAt, updatedAt",
      programWeeks: "++id, programId, order, [programId+order]",
      programWorkouts: "++id, programWeekId, templateId, order, [programWeekId+order]",
      programWorkoutExerciseOverrides: "++id, programWorkoutId, exerciseId, &[programWorkoutId+exerciseId]"
    });

    this.version(7)
      .stores({
        gyms: "++id, name, createdAt",
        exercises: "++id, name, category, createdAt",
        exerciseGymProfiles: "++id, exerciseId, gymId, &[exerciseId+gymId]",
        workouts: "++id, date, status, gymId, createdAt, updatedAt",
        workoutExercises: "++id, workoutId, exerciseId, order",
        workoutSets: "++id, workoutExerciseId, setNumber, &[workoutExerciseId+setNumber]",
        workoutTemplates: "++id, name, createdAt, updatedAt",
        workoutTemplateExercises: "++id, templateId, exerciseId, order",
        programs: "++id, name, createdAt, updatedAt",
        programWeeks: "++id, programId, order, [programId+order]",
        programWorkouts: "++id, programWeekId, templateId, order, [programWeekId+order]",
        programWorkoutExerciseOverrides: "++id, programWorkoutId, exerciseId, &[programWorkoutId+exerciseId]"
      })
      .upgrade((transaction) => transaction.table("workouts").toCollection().modify((workout) => {
        if (!workout.status) workout.status = "completed";
      }));

    this.version(8).stores({
      gyms: "++id, name, createdAt",
      exercises: "++id, name, category, createdAt",
      exerciseGymProfiles: "++id, exerciseId, gymId, &[exerciseId+gymId]",
      workouts: "++id, date, status, gymId, programId, programWorkoutId, createdAt, updatedAt",
      workoutExercises: "++id, workoutId, exerciseId, order",
      workoutSets: "++id, workoutExerciseId, setNumber, &[workoutExerciseId+setNumber]",
      workoutTemplates: "++id, name, createdAt, updatedAt",
      workoutTemplateExercises: "++id, templateId, exerciseId, order",
      programs: "++id, name, createdAt, updatedAt",
      programWeeks: "++id, programId, order, [programId+order]",
      programWorkouts: "++id, programWeekId, templateId, order, [programWeekId+order]",
      programWorkoutExerciseOverrides: "++id, programWorkoutId, exerciseId, &[programWorkoutId+exerciseId]",
      activeProgramStates: "++id, &programId, currentProgramWeekId, currentProgramWorkoutId"
    });

  }
}

export const db = new WorkoutLogDatabase();
