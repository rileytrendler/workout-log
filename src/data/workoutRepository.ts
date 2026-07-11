import { db } from "../db/db";
import type {
  Exercise,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  WorkoutTemplateExercise
} from "../db/types";

export type ApplyWorkoutTemplateResult = {
  workout: Workout;
  createdWorkout: boolean;
  addedExerciseCount: number;
  skippedExerciseNames: string[];
};

export type PreviousPerformanceResult = {
  workout: Workout;
  workoutExercise: WorkoutExercise;
  sets: WorkoutSet[];
};

export type WorkoutExerciseContext = {
  workoutExercise: WorkoutExercise;
  exercise: Exercise;
};

export async function getWorkoutExerciseContext(
  workoutExerciseId: number
): Promise<WorkoutExerciseContext | null> {
  const workoutExercise = await db.workoutExercises.get(
    workoutExerciseId
  );

  if (!workoutExercise) return null;

  const exercise = await db.exercises.get(
    workoutExercise.exerciseId
  );

  if (!exercise) return null;

  return {
    workoutExercise,
    exercise
  };
}

function nowString() {
  return new Date().toISOString();
}

function getSetPerformedTime(set: WorkoutSet) {
  return set.performedAt ?? set.createdAt;
}

function snapshotTemplateExercise(
  templateExercise: WorkoutTemplateExercise,
  workoutId: number,
  order: number,
  now: string
): WorkoutExercise {
  return {
    workoutId,
    exerciseId: templateExercise.exerciseId,
    order,
    plannedSetCount: templateExercise.plannedSetCount,
    targetMinReps: templateExercise.targetMinReps,
    targetMaxReps: templateExercise.targetMaxReps,
    targetRpeMin: templateExercise.targetRpeMin,
    targetRpeMax: templateExercise.targetRpeMax,
    targetRestSeconds: templateExercise.targetRestSeconds,
    warmupInstructions: templateExercise.warmupInstructions,
    prescriptionNotes: templateExercise.prescriptionNotes,
    startedAt: now,
    createdAt: now,
    updatedAt: now
  };
}

export async function applyWorkoutTemplateToDate(
  date: string,
  templateId: number
): Promise<ApplyWorkoutTemplateResult> {
  return await db.transaction(
    "rw",
    db.workoutTemplates,
    db.workoutTemplateExercises,
    db.workouts,
    db.workoutExercises,
    db.exercises,
    async () => {
      const template = await db.workoutTemplates.get(templateId);

      if (!template) {
        throw new Error("Workout template could not be found.");
      }

      const templateExercises = await db.workoutTemplateExercises
        .where("templateId")
        .equals(templateId)
        .sortBy("order");

      if (!templateExercises.length) {
        throw new Error(
          `“${template.name}” is empty. Add at least one exercise before starting it.`
        );
      }

      const now = nowString();
      let workout = await db.workouts.where("date").equals(date).first();
      const createdWorkout = !workout;

      if (!workout) {
        const workoutId = await db.workouts.add({
          date,
          title: template.name,
          notes: template.notes?.trim() || undefined,
          startTime: now,
          createdAt: now,
          updatedAt: now
        });

        workout = await db.workouts.get(workoutId);
      }

      if (!workout?.id) {
        throw new Error("Workout could not be created.");
      }

      const existingRows = await db.workoutExercises
        .where("workoutId")
        .equals(workout.id)
        .toArray();
      const existingExerciseIds = new Set(
        existingRows.map((row) => row.exerciseId)
      );
      const exercisesToAdd = templateExercises.filter(
        (row) => !existingExerciseIds.has(row.exerciseId)
      );
      const skippedExerciseIds = templateExercises
        .filter((row) => existingExerciseIds.has(row.exerciseId))
        .map((row) => row.exerciseId);
      const nextOrder =
        Math.max(0, ...existingRows.map((row) => row.order)) + 1;

      if (exercisesToAdd.length) {
        await db.workoutExercises.bulkAdd(
          exercisesToAdd.map((row, index) =>
            snapshotTemplateExercise(
              row,
              workout!.id!,
              nextOrder + index,
              now
            )
          )
        );
      }

      await db.workouts.update(workout.id, { updatedAt: now });

      const skippedExercises = skippedExerciseIds.length
        ? await db.exercises.bulkGet(skippedExerciseIds)
        : [];
      const updatedWorkout = await db.workouts.get(workout.id);

      if (!updatedWorkout) {
        throw new Error("Workout could not be loaded.");
      }

      return {
        workout: updatedWorkout,
        createdWorkout,
        addedExerciseCount: exercisesToAdd.length,
        skippedExerciseNames: skippedExercises.map(
          (exercise, index) =>
            exercise?.name ?? `Exercise ${skippedExerciseIds[index]}`
        )
      };
    }
  );
}

export async function getPreviousPerformance(
  workoutExerciseId: number
): Promise<PreviousPerformanceResult | null> {
  const currentWorkoutExercise = await db.workoutExercises.get(workoutExerciseId);

  if (!currentWorkoutExercise) return null;

  const currentWorkout = await db.workouts.get(currentWorkoutExercise.workoutId);

  if (!currentWorkout) return null;

  const matchingExerciseRows = await db.workoutExercises
    .where("exerciseId")
    .equals(currentWorkoutExercise.exerciseId)
    .toArray();

  const candidates: {
    workout: Workout;
    workoutExercise: WorkoutExercise;
    sortTime: number;
  }[] = [];

  const currentWorkoutTime = new Date(
    currentWorkout.startTime ?? currentWorkout.createdAt
  ).getTime();

  for (const workoutExercise of matchingExerciseRows) {
    if (
      !workoutExercise.id ||
      workoutExercise.workoutId === currentWorkoutExercise.workoutId
    ) {
      continue;
    }

    const candidateWorkout = await db.workouts.get(workoutExercise.workoutId);

    if (!candidateWorkout) continue;

    const candidateWorkoutTime = new Date(
      candidateWorkout.startTime ?? candidateWorkout.createdAt
    ).getTime();

    if (candidateWorkoutTime >= currentWorkoutTime) continue;

    candidates.push({
      workout: candidateWorkout,
      workoutExercise,
      sortTime: candidateWorkoutTime
    });
  }

  candidates.sort((a, b) => b.sortTime - a.sortTime);

  const previous = candidates[0];

  if (!previous?.workoutExercise.id) return null;

  const sets = await db.workoutSets
    .where("workoutExerciseId")
    .equals(previous.workoutExercise.id)
    .sortBy("setNumber");

  return {
    workout: previous.workout,
    workoutExercise: previous.workoutExercise,
    sets
  };
}

export type SetPerformanceInput = {
  weight?: number;
  reps: number;
  actualRpe?: number;
};

export async function saveSetPerformance(
  workoutExerciseId: number,
  setNumber: number,
  input: SetPerformanceInput
): Promise<number> {
  const workoutExercise = await db.workoutExercises.get(
    workoutExerciseId
  );

  if (!workoutExercise) {
    throw new Error("Workout exercise could not be found.");
  }

  const existingSet = await db.workoutSets
    .where("[workoutExerciseId+setNumber]")
    .equals([workoutExerciseId, setNumber])
    .first();

  const now = nowString();

  if (existingSet?.id) {
    await db.transaction(
      "rw",
      db.workoutSets,
      db.workouts,
      async () => {
        await db.workoutSets.update(existingSet.id!, {
          weight: input.weight,
          reps: input.reps,
          actualRpe: input.actualRpe,
          updatedAt: now
        });

        await db.workouts.update(workoutExercise.workoutId, {
          updatedAt: now
        });
      }
    );

    return existingSet.id;
  }

  return await db.transaction(
    "rw",
    db.workoutSets,
    db.workouts,
    async () => {
      const setId = await db.workoutSets.add({
        workoutExerciseId,
        setNumber,
        weight: input.weight,
        reps: input.reps,
        actualRpe: input.actualRpe,
        performedAt: now,
        createdAt: now,
        updatedAt: now
      });

      await db.workouts.update(workoutExercise.workoutId, {
        lastSetAt: now,
        updatedAt: now
      });

      return setId;
    }
  );
}

export async function updateSetNote(
  setId: number,
  notes: string
): Promise<void> {
  await db.workoutSets.update(setId, {
    notes: notes.trim() || undefined,
    updatedAt: nowString()
  });
}

export async function updateSetPerformedTime(
  setId: number,
  performedAt?: string
): Promise<void> {
  const set = await db.workoutSets.get(setId);

  if (!set) {
    throw new Error("Set could not be found.");
  }

  await db.workoutSets.update(setId, {
    performedAt,
    updatedAt: nowString()
  });

  const workoutExercise = await db.workoutExercises.get(
    set.workoutExerciseId
  );

  if (workoutExercise) {
    await recalculateWorkoutLastSetAt(workoutExercise.workoutId);
  }
}

export async function deleteWorkoutSet(setId: number): Promise<void> {
  const set = await db.workoutSets.get(setId);

  if (!set) return;

  const workoutExercise = await db.workoutExercises.get(
    set.workoutExerciseId
  );

  await db.workoutSets.delete(setId);

  if (workoutExercise) {
    await recalculateWorkoutLastSetAt(workoutExercise.workoutId);
  }
}

export async function recalculateWorkoutLastSetAt(
  workoutId: number
): Promise<void> {
  const workoutExercises = await db.workoutExercises
    .where("workoutId")
    .equals(workoutId)
    .toArray();

  const workoutExerciseIds = workoutExercises
    .map((workoutExercise) => workoutExercise.id)
    .filter((id): id is number => id !== undefined);

  let latestSetTime: string | undefined;

  if (workoutExerciseIds.length) {
    const sets = await db.workoutSets
      .where("workoutExerciseId")
      .anyOf(workoutExerciseIds)
      .toArray();

    latestSetTime = sets
      .map(getSetPerformedTime)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
  }

  await db.workouts.update(workoutId, {
    lastSetAt: latestSetTime,
    updatedAt: nowString()
  });
}

export async function getOrCreateWorkoutForDate(
  date: string,
  defaultTitle = "Today's Workout"
): Promise<Workout> {
  const existingWorkout = await db.workouts
    .where("date")
    .equals(date)
    .first();

  if (existingWorkout) {
    return existingWorkout;
  }

  const now = nowString();

  const workoutId = await db.workouts.add({
    date,
    title: defaultTitle,
    startTime: now,
    createdAt: now,
    updatedAt: now
  });

  const workout = await db.workouts.get(workoutId);

  if (!workout) {
    throw new Error("Workout could not be created.");
  }

  return workout;
}

export async function addExerciseToWorkout(
  workoutId: number,
  exerciseId: number
): Promise<number> {
  const existingRows = await db.workoutExercises
    .where("workoutId")
    .equals(workoutId)
    .toArray();

  const alreadyAdded = existingRows.some(
    (workoutExercise) => workoutExercise.exerciseId === exerciseId
  );

  if (alreadyAdded) {
    throw new Error("That exercise is already in this workout.");
  }

  const now = nowString();

  const workoutExerciseId = await db.workoutExercises.add({
    workoutId,
    exerciseId,
    order: existingRows.length + 1,
    startedAt: now,
    createdAt: now,
    updatedAt: now
  });

  await db.workouts.update(workoutId, {
    updatedAt: now
  });

  return workoutExerciseId;
}

export async function updateWorkoutText(
  workoutId: number,
  changes: {
    title?: string;
    notes?: string;
  }
): Promise<void> {
  await db.workouts.update(workoutId, {
    ...changes,
    updatedAt: nowString()
  });
}

export async function updateWorkoutExerciseNotes(
  workoutExerciseId: number,
  notes: string
): Promise<void> {
  const workoutExercise = await db.workoutExercises.get(
    workoutExerciseId
  );

  if (!workoutExercise) {
    throw new Error("Workout exercise could not be found.");
  }

  const now = nowString();

  await db.transaction(
    "rw",
    db.workoutExercises,
    db.workouts,
    async () => {
      await db.workoutExercises.update(workoutExerciseId, {
        notes,
        updatedAt: now
      });

      await db.workouts.update(workoutExercise.workoutId, {
        updatedAt: now
      });
    }
  );
}

export async function removeExerciseFromWorkout(
  workoutExerciseId: number
): Promise<void> {
  const workoutExercise = await db.workoutExercises.get(
    workoutExerciseId
  );

  if (!workoutExercise) return;

  await db.transaction(
    "rw",
    db.workoutExercises,
    db.workoutSets,
    async () => {
      await db.workoutSets
        .where("workoutExerciseId")
        .equals(workoutExerciseId)
        .delete();

      await db.workoutExercises.delete(workoutExerciseId);
    }
  );

  await recalculateWorkoutLastSetAt(workoutExercise.workoutId);
}
