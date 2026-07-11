export type ExerciseMeasurementType =
  | "weight_reps"
  | "reps_only"
  | "bodyweight_added_weight";

export type Gym = {
  id?: number;
  name: string;
  notes?: string;
  createdAt: string;
};

export type Exercise = {
  id?: number;
  name: string;
  category?: string;
  defaultUnit: "lb" | "kg";
  measurementType?: ExerciseMeasurementType;
  setupNotes?: string;
  formCues?: string;
  generalNotes?: string;
  defaultRestSeconds?: number;
  createdAt: string;
  updatedAt?: string;
};

export type Workout = {
  id?: number;
  date: string;
  gymId?: number;
  bodyweight?: number;
  title?: string;
  notes?: string;
  startTime?: string;
  endTime?: string;
  lastSetAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkoutExercise = {
  id?: number;
  workoutId: number;
  exerciseId: number;
  order: number;

  notes?: string;
  startedAt?: string;

  plannedSetCount?: number;
  targetMinReps?: number;
  targetMaxReps?: number;
  targetRpeMin?: number;
  targetRpeMax?: number;
  targetRestSeconds?: number;
  warmupInstructions?: string;
  prescriptionNotes?: string;

  createdAt?: string;
  updatedAt?: string;
};

export type WorkoutSet = {
  id?: number;
  workoutExerciseId: number;
  setNumber: number;
  weight?: number;
  reps?: number;
  actualRpe?: number;
  rir?: number;
  isWarmup?: boolean;
  isFailure?: boolean;
  notes?: string;
  performedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkoutTemplate = {
  id?: number;
  name: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkoutTemplateExercise = {
  id?: number;
  templateId: number;
  exerciseId: number;
  order: number;

  plannedSetCount?: number;
  targetMinReps?: number;
  targetMaxReps?: number;
  targetRpeMin?: number;
  targetRpeMax?: number;
  targetRestSeconds?: number;

  warmupInstructions?: string;
  prescriptionNotes?: string;

  createdAt: string;
  updatedAt: string;
};

export type ExerciseGymProfile = {
  id?: number;
  exerciseId: number;
  gymId: number;
  equipmentName?: string;
  setupNotes?: string;
  calibrationNotes?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProgramEndBehavior = "stop" | "repeat" | "continue_last_week";

export type Program = {
  id?: number;
  name: string;
  notes?: string;
  endBehavior: ProgramEndBehavior;
  createdAt: string;
  updatedAt: string;
};

export type ProgramWeek = {
  id?: number;
  programId: number;
  order: number;
  name?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProgramWorkout = {
  id?: number;
  programWeekId: number;
  templateId: number;
  order: number;
  displayName?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProgramWorkoutExerciseOverride = {
  id?: number;
  programWorkoutId: number;
  exerciseId: number;
  plannedSetCount?: number;
  targetMinReps?: number;
  targetMaxReps?: number;
  targetRpeMin?: number;
  targetRpeMax?: number;
  targetRestSeconds?: number;
  warmupInstructions?: string;
  prescriptionNotes?: string;
  createdAt: string;
  updatedAt: string;
};
