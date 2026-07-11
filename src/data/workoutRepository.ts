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

export type PriorExercisePerformance = {
  workout: Workout;
  workoutExercise: WorkoutExercise;
  sets: WorkoutSet[];
  gymName?: string;
};

export type ExerciseComparisonResult = {
  lastAtCurrentGym?: PriorExercisePerformance;
  latestAnywhere?: PriorExercisePerformance;
  bestBySetNumber: Record<number, PriorSetReference>;
};

export type PriorSetReference = {
  set: WorkoutSet;
  workout: Workout;
  workoutExercise: WorkoutExercise;
  gymName?: string;
  performedAt: string;
  matchedTargetRepRange: boolean;
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

export async function startWorkoutFromTemplate(
  date: string,
  templateId: number,
  defaultGymId?: number
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
      let workout = await db.workouts.where("status").equals("active").first();
      const createdWorkout = !workout;

      if (!workout) {
        const workoutId = await db.workouts.add({
          date,
          status: "active",
          gymId: defaultGymId,
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

export async function getExerciseComparisons(
  workoutExerciseId: number
): Promise<ExerciseComparisonResult> {
  const currentWorkoutExercise = await db.workoutExercises.get(workoutExerciseId);

  if (!currentWorkoutExercise) return { bestBySetNumber: {} };

  const currentWorkout = await db.workouts.get(currentWorkoutExercise.workoutId);

  if (!currentWorkout) return { bestBySetNumber: {} };

  const exercise = await db.exercises.get(currentWorkoutExercise.exerciseId);
  const measurementType = exercise?.measurementType ?? "weight_reps";

  const matchingExerciseRows = await db.workoutExercises
    .where("exerciseId")
    .equals(currentWorkoutExercise.exerciseId)
    .toArray();

  const currentWorkoutTime = new Date(
    currentWorkout.startTime ?? currentWorkout.createdAt
  ).getTime();
  const priorRows = matchingExerciseRows.filter(
    (row): row is WorkoutExercise & { id: number } =>
      row.id !== undefined && row.workoutId !== currentWorkoutExercise.workoutId
  );
  const workouts = await db.workouts.bulkGet(priorRows.map((row) => row.workoutId));
  const sets = priorRows.length
    ? await db.workoutSets.where("workoutExerciseId").anyOf(priorRows.map((row) => row.id)).toArray()
    : [];
  const setsByWorkoutExercise = new Map<number, WorkoutSet[]>();

  for (const set of sets) {
    if (
      set.isWarmup ||
      set.reps === undefined ||
      (measurementType !== "reps_only" && set.weight === undefined) ||
      !getSetPerformedTime(set)
    ) continue;
    const existing = setsByWorkoutExercise.get(set.workoutExerciseId) ?? [];
    existing.push(set);
    setsByWorkoutExercise.set(set.workoutExerciseId, existing);
  }

  const candidates = priorRows.flatMap((workoutExercise, index) => {
    const workout = workouts[index];
    const usableSets = setsByWorkoutExercise.get(workoutExercise.id);
    if (!workout || !usableSets?.length) return [];
    const sortTime = new Date(workout.startTime ?? workout.createdAt).getTime();
    const isFutureWorkout = workout.date > currentWorkout.date ||
      (workout.date === currentWorkout.date &&
        (!Number.isFinite(sortTime) || sortTime >= currentWorkoutTime));
    if (isFutureWorkout) return [];
    return [{ workout, workoutExercise, sets: usableSets.sort((a, b) => a.setNumber - b.setNumber), sortTime }];
  }).sort((a, b) => b.sortTime - a.sortTime);

  const lastAtCurrentGym = currentWorkout.gymId === undefined
    ? undefined
    : candidates.find((candidate) => candidate.workout.gymId === currentWorkout.gymId);
  const latestAnywhere = candidates[0];
  const selected = candidates.filter(
    (candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)
  );
  const gymIds = [...new Set(selected.map((candidate) => candidate.workout.gymId)
    .filter((id): id is number => id !== undefined))];
  const gyms = await db.gyms.bulkGet(gymIds);
  const gymNames = new Map(gymIds.map((id, index) => [id, gyms[index]?.name ?? "Unknown gym"]));
  const toPerformance = (candidate: typeof candidates[number] | undefined) => candidate ? {
    workout: candidate.workout,
    workoutExercise: candidate.workoutExercise,
    sets: candidate.sets,
    gymName: candidate.workout.gymId === undefined
      ? undefined
      : gymNames.get(candidate.workout.gymId) ?? "Unknown gym"
  } : undefined;

  const hasTargetRepRange =
    currentWorkoutExercise.targetMinReps !== undefined &&
    currentWorkoutExercise.targetMaxReps !== undefined;
  const referencesBySetNumber = new Map<number, Array<PriorSetReference>>();

  for (const candidate of candidates) {
    for (const set of candidate.sets) {
      const performedAt = getSetPerformedTime(set);
      if (!performedAt) continue;
      const references = referencesBySetNumber.get(set.setNumber) ?? [];
      references.push({
        set,
        workout: candidate.workout,
        workoutExercise: candidate.workoutExercise,
        gymName: candidate.workout.gymId === undefined
          ? undefined
          : gymNames.get(candidate.workout.gymId) ?? "Unknown gym",
        performedAt,
        matchedTargetRepRange: hasTargetRepRange &&
          set.reps! >= currentWorkoutExercise.targetMinReps! &&
          set.reps! <= currentWorkoutExercise.targetMaxReps!
      });
      referencesBySetNumber.set(set.setNumber, references);
    }
  }

  const bestBySetNumber: Record<number, PriorSetReference> = {};
  for (const [setNumber, allReferences] of referencesBySetNumber) {
    const inTargetRange = allReferences.filter(
      (reference) => reference.matchedTargetRepRange
    );
    const rankedReferences = inTargetRange.length ? inTargetRange : allReferences;
    rankedReferences.sort((a, b) => {
      if (measurementType === "reps_only") {
        return b.set.reps! - a.set.reps! ||
          new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime();
      }
      return b.set.weight! - a.set.weight! ||
        b.set.reps! - a.set.reps! ||
        new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime();
    });
    bestBySetNumber[setNumber] = rankedReferences[0];
  }

  return {
    lastAtCurrentGym: toPerformance(lastAtCurrentGym),
    latestAnywhere: toPerformance(latestAnywhere),
    bestBySetNumber
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
): Promise<{ setId: number; created: boolean }> {
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

    return { setId: existingSet.id, created: false };
  }

  const setId = await db.transaction(
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

  return { setId, created: true };
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

export type HistoricalSetChanges = {
  weight: number;
  reps: number;
  actualRpe?: number;
  notes?: string;
};

export async function updateHistoricalSet(
  setId: number,
  changes: HistoricalSetChanges
): Promise<void> {
  await db.workoutSets.update(setId, {
    weight: changes.weight,
    reps: changes.reps,
    actualRpe: changes.actualRpe,
    notes: changes.notes?.trim() || undefined,
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

export async function getActiveWorkout(): Promise<Workout | undefined> {
  return db.workouts.where("status").equals("active").first();
}

export async function startBlankWorkout(
  date: string,
  defaultTitle = "Workout",
  defaultGymId?: number
): Promise<Workout> {
  return db.transaction("rw", db.workouts, async () => {
    const existing = await getActiveWorkout();
    if (existing) throw new Error("A workout is already active. Finish it before starting another.");
    const now = nowString();
    const id = await db.workouts.add({ date, status: "active", gymId: defaultGymId, title: defaultTitle, startTime: now, createdAt: now, updatedAt: now });
    const workout = await db.workouts.get(id);
    if (!workout) throw new Error("Workout could not be created.");
    return workout;
  });
}

export async function finishWorkout(workoutId: number): Promise<Workout> {
  return db.transaction("rw", db.workouts, async () => {
    const workout = await db.workouts.get(workoutId);
    if (!workout || workout.status !== "active") throw new Error("This workout is no longer active.");
    const now = nowString();
    await db.workouts.update(workoutId, { status: "completed", completedAt: now, updatedAt: now });
    return { ...workout, status: "completed", completedAt: now, updatedAt: now };
  });
}

export async function reopenWorkout(workoutId: number): Promise<Workout> {
  return db.transaction("rw", db.workouts, async () => {
    const existing = await getActiveWorkout();
    if (existing && existing.id !== workoutId) throw new Error("Finish the current active workout before reopening another workout.");
    const workout = await db.workouts.get(workoutId);
    if (!workout) throw new Error("Workout could not be found.");
    const now = nowString();
    await db.workouts.update(workoutId, { status: "active", completedAt: undefined, updatedAt: now });
    return { ...workout, status: "active", completedAt: undefined, updatedAt: now };
  });
}

export async function updateWorkoutGym(workoutId: number, gymId?: number): Promise<void> {
  await db.workouts.update(workoutId, { gymId, updatedAt: nowString() });
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
