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
  notes?: string;
  createdAt: string;
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
  createdAt?: string;
  updatedAt?: string;
};

export type WorkoutSet = {
  id?: number;
  workoutExerciseId: number;
  setNumber: number;
  weight?: number;
  reps?: number;
  rpe?: number;
  rir?: number;
  isWarmup?: boolean;
  isFailure?: boolean;
  notes?: string;
  performedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};