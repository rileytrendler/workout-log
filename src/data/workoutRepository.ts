import { db } from "../db/db";
import type {
  Exercise,
  ExerciseMeasurementType,
  ExerciseGymProfile,
  Gym,
  Workout,
  WorkoutExercise,
  WorkoutExerciseQualityFlag,
  WorkoutSet,
  WorkoutSetMyoSet,
  WorkoutTemplateExercise
} from "../db/types";
import { advanceActiveProgram } from "./programRepository";
import {
  compareBestSetPerformance,
  findFinalWorkingSet,
  isInCompletedRepRange,
  validateStoredRepResult
} from "../utils/failureSemantics";
import { derivePersonalRecordStatuses, type PersonalRecordStatus } from "../utils/personalRecords";

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

export type ExerciseHistorySession = PriorExercisePerformance & {
  gym?: Gym;
};

export type ExerciseHistoryResult = {
  exercise: Exercise;
  sessions: ExerciseHistorySession[];
  latestAnywhere?: PriorExercisePerformance;
  lastAtSelectedGym?: PriorExercisePerformance;
  bestBySetNumber: Record<number, PriorSetReference>;
  selectedGymProfile?: ExerciseGymProfile;
};

export async function getPersonalRecordStatuses(): Promise<Map<number, PersonalRecordStatus>> {
  const [exercises, workouts, workoutExercises, workoutSets] = await Promise.all([
    db.exercises.toArray(),
    db.workouts.toArray(),
    db.workoutExercises.toArray(),
    db.workoutSets.toArray()
  ]);
  return derivePersonalRecordStatuses({ exercises, workouts, workoutExercises, workoutSets });
}

function rankBestReferences(
  referencesBySetNumber: Map<number, PriorSetReference[]>,
  measurementType: ExerciseMeasurementType
) {
  const bestBySetNumber: Record<number, PriorSetReference> = {};
  for (const [setNumber, allReferences] of referencesBySetNumber) {
    const inTargetRange = allReferences.filter((reference) => reference.matchedTargetRepRange);
    const rankedReferences = [...(inTargetRange.length ? inTargetRange : allReferences)];
    rankedReferences.sort((a, b) => {
      return compareBestSetPerformance(a.set, b.set, measurementType) ||
        new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime();
    });
    bestBySetNumber[setNumber] = rankedReferences[0];
  }
  return bestBySetNumber;
}

export async function getExerciseHistory(
  exerciseId: number,
  selectedGymId?: number,
  excludedWorkoutId?: number
): Promise<ExerciseHistoryResult | null> {
  const exercise = await db.exercises.get(exerciseId);
  if (!exercise) return null;

  const rows = (await db.workoutExercises.where("exerciseId").equals(exerciseId).toArray())
    .filter((row): row is WorkoutExercise & { id: number } =>
      row.id !== undefined && row.workoutId !== excludedWorkoutId);
  const workouts = await db.workouts.bulkGet(rows.map((row) => row.workoutId));
  const sets = rows.length
    ? await db.workoutSets.where("workoutExerciseId").anyOf(rows.map((row) => row.id)).toArray()
    : [];
  const workingSets = sets.filter((set) => !set.isWarmup && set.reps !== undefined &&
    ((exercise.measurementType ?? "weight_reps") === "reps_only" || set.weight !== undefined) &&
    Boolean(getSetPerformedTime(set)));
  const setsByRow = new Map<number, WorkoutSet[]>();
  for (const set of workingSets) {
    const grouped = setsByRow.get(set.workoutExerciseId) ?? [];
    grouped.push(set);
    setsByRow.set(set.workoutExerciseId, grouped);
  }
  const gymIds = [...new Set(workouts.flatMap((workout) => workout?.gymId === undefined ? [] : [workout.gymId]))];
  const gymRows = await db.gyms.bulkGet(gymIds);
  const gymMap = new Map(gymIds.map((id, index) => [id, gymRows[index]]));
  const allSessions = rows.flatMap((workoutExercise, index) => {
    const workout = workouts[index];
    const sessionSets = setsByRow.get(workoutExercise.id);
    if (!workout || !sessionSets?.length) return [];
    return [{ workout, workoutExercise, sets: sessionSets.sort((a, b) => a.setNumber - b.setNumber),
      gym: workout.gymId === undefined ? undefined : gymMap.get(workout.gymId),
      gymName: workout.gymId === undefined ? undefined : gymMap.get(workout.gymId)?.name ?? "Unknown gym" }];
  }).sort((a, b) => {
    const time = (value: Workout) => new Date(value.startTime ?? value.createdAt).getTime();
    return time(b.workout) - time(a.workout) || (b.workout.id ?? 0) - (a.workout.id ?? 0);
  });
  const sessions = selectedGymId === undefined
    ? allSessions
    : allSessions.filter((session) => session.workout.gymId === selectedGymId);
  const references = new Map<number, PriorSetReference[]>();
  for (const session of sessions) for (const set of session.sets) {
    const performedAt = getSetPerformedTime(set)!;
    const values = references.get(set.setNumber) ?? [];
    values.push({ set, workout: session.workout, workoutExercise: session.workoutExercise,
      gymName: session.gymName, performedAt, matchedTargetRepRange: false });
    references.set(set.setNumber, values);
  }
  const toPerformance = (session?: ExerciseHistorySession): PriorExercisePerformance | undefined =>
    session && ({ workout: session.workout, workoutExercise: session.workoutExercise,
      sets: session.sets, gymName: session.gymName });
  const selectedGymProfile = selectedGymId === undefined ? undefined
    : await db.exerciseGymProfiles.where("[exerciseId+gymId]").equals([exerciseId, selectedGymId]).first();
  return { exercise, sessions, latestAnywhere: toPerformance(allSessions[0]),
    lastAtSelectedGym: toPerformance(selectedGymId === undefined ? undefined : allSessions.find((s) => s.workout.gymId === selectedGymId)),
    bestBySetNumber: rankBestReferences(references, exercise.measurementType ?? "weight_reps"), selectedGymProfile };
}

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
  prescribedExerciseName: string,
  workoutId: number,
  order: number,
  now: string
): WorkoutExercise {
  return {
    workoutId,
    exerciseId: templateExercise.exerciseId,
    order,
    sourceTemplateExerciseId: templateExercise.id,
    prescribedExerciseId: templateExercise.exerciseId,
    prescribedExerciseNameSnapshot: prescribedExerciseName,
    plannedSetCount: templateExercise.plannedSetCount,
    targetMinReps: templateExercise.targetMinReps,
    targetMaxReps: templateExercise.targetMaxReps,
    targetRpeMin: templateExercise.targetRpeMin,
    targetRpeMax: templateExercise.targetRpeMax,
    targetRestSeconds: templateExercise.targetRestSeconds,
    warmupInstructions: templateExercise.warmupInstructions,
    prescriptionNotes: templateExercise.prescriptionNotes,
    plannedLastSetIntensityTechnique: templateExercise.plannedLastSetIntensityTechnique,
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
    [db.workoutTemplates, db.workoutTemplateExercises, db.workouts, db.workoutExercises,
      db.exercises, db.workoutTemplateExerciseSubstitutions, db.workoutExerciseSubstitutionOptions],
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
        const sourceIds = exercisesToAdd.flatMap((row) => row.id ?? []);
        const substitutions = sourceIds.length
          ? await db.workoutTemplateExerciseSubstitutions.where("templateExerciseId").anyOf(sourceIds).toArray()
          : [];
        const exerciseIds = [...new Set(exercisesToAdd.map((row) => row.exerciseId)
          .concat(substitutions.map((row) => row.substituteExerciseId)))];
        const exerciseRows = await db.exercises.bulkGet(exerciseIds);
        const nameById = new Map(exerciseIds.map((id, index) => [id, exerciseRows[index]?.name ?? `Exercise ${id}`]));
        for (const [index, row] of exercisesToAdd.entries()) {
          const workoutExerciseId = await db.workoutExercises.add(snapshotTemplateExercise(
            row, nameById.get(row.exerciseId)!, workout!.id!, nextOrder + index, now));
          const options = substitutions.filter((option) => option.templateExerciseId === row.id).sort((a, b) => a.order - b.order);
          if (options.length) await db.workoutExerciseSubstitutionOptions.bulkAdd(options.map((option, optionIndex) => ({
            workoutExerciseId,
            exerciseId: option.substituteExerciseId,
            order: optionIndex + 1,
            exerciseNameSnapshot: nameById.get(option.substituteExerciseId)!,
            createdAt: now
          })));
        }
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

export type WorkoutExerciseSubstitutionChoice = {
  exerciseId: number;
  name: string;
  isPrescribed: boolean;
};

export async function getWorkoutExerciseSubstitutionChoices(workoutExerciseId: number): Promise<WorkoutExerciseSubstitutionChoice[]> {
  const workoutExercise = await db.workoutExercises.get(workoutExerciseId);
  if (!workoutExercise?.prescribedExerciseId || !workoutExercise.prescribedExerciseNameSnapshot) return [];
  const options = await db.workoutExerciseSubstitutionOptions.where("workoutExerciseId").equals(workoutExerciseId).sortBy("order");
  if (!options.length) return [];
  return [{
    exerciseId: workoutExercise.prescribedExerciseId,
    name: workoutExercise.prescribedExerciseNameSnapshot,
    isPrescribed: true
  }, ...options.map((option) => ({
    exerciseId: option.exerciseId,
    name: option.exerciseNameSnapshot,
    isPrescribed: false
  }))];
}

export async function swapWorkoutExercise(workoutExerciseId: number, exerciseId: number): Promise<void> {
  await db.transaction("rw", db.workoutExercises, db.workoutExerciseSubstitutionOptions, db.workoutSets, db.workouts, db.exercises, async () => {
    const workoutExercise = await db.workoutExercises.get(workoutExerciseId);
    if (!workoutExercise?.prescribedExerciseId) throw new Error("This exercise does not come from a template substitution slot.");
    const options = await db.workoutExerciseSubstitutionOptions.where("workoutExerciseId").equals(workoutExerciseId).toArray();
    const allowed = exerciseId === workoutExercise.prescribedExerciseId || options.some((option) => option.exerciseId === exerciseId);
    if (!allowed) throw new Error("That exercise is not an allowed substitute for this workout slot.");
    if (!await db.exercises.get(exerciseId)) throw new Error("That substitute is no longer available in the exercise library.");
    if (await db.workoutSets.where("workoutExerciseId").equals(workoutExerciseId).count()) {
      throw new Error("This exercise already has recorded sets. Delete the sets before swapping exercises.");
    }
    if (workoutExercise.exerciseId === exerciseId) return;
    const duplicate = await db.workoutExercises.where("workoutId").equals(workoutExercise.workoutId)
      .and((row) => row.id !== workoutExerciseId && row.exerciseId === exerciseId).first();
    if (duplicate) throw new Error("That exercise is already in this workout.");
    const now = nowString();
    await db.workoutExercises.update(workoutExerciseId, { exerciseId, updatedAt: now });
    await db.workouts.update(workoutExercise.workoutId, { updatedAt: now });
  });
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
        matchedTargetRepRange: hasTargetRepRange && isInCompletedRepRange(
          set,
          currentWorkoutExercise.targetMinReps!,
          currentWorkoutExercise.targetMaxReps!
        )
      });
      referencesBySetNumber.set(set.setNumber, references);
    }
  }

  const bestBySetNumber = rankBestReferences(referencesBySetNumber, measurementType);

  return {
    lastAtCurrentGym: toPerformance(lastAtCurrentGym),
    latestAnywhere: toPerformance(latestAnywhere),
    bestBySetNumber
  };
}

export type SetPerformanceInput = {
  weight?: number;
  reps: number;
  failedOnRep?: number;
  actualRpe?: number;
};

function validateFailure(reps: number, failedOnRep?: number, actualRpe?: number) {
  const error = validateStoredRepResult({ reps, failedOnRep, actualRpe }, true);
  if (error) throw new Error(error);
}

export async function clearFinalSetAdvancedDetails(workoutExerciseId: number, mainSetId?: number) {
  const setIds = mainSetId ? [mainSetId] : (await db.workoutSets.where("workoutExerciseId").equals(workoutExerciseId).primaryKeys());
  if (setIds.length) await db.workoutSetMyoSets.where("workoutSetId").anyOf(setIds).delete();
  await db.workoutExercises.update(workoutExerciseId, {
    actualLastSetIntensityTechnique: undefined,
    longLengthPartialReps: undefined,
    updatedAt: nowString()
  });
}

export async function saveSetPerformance(
  workoutExerciseId: number,
  setNumber: number,
  input: SetPerformanceInput
): Promise<{ setId: number; created: boolean }> {
  validateFailure(input.reps, input.failedOnRep, input.actualRpe);
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
      db.workoutExercises,
      db.workouts,
      db.workoutSetMyoSets,
      async () => {
        await db.workoutSets.update(existingSet.id!, {
          weight: input.weight,
          reps: input.reps,
          failedOnRep: input.failedOnRep,
          isFailure: input.failedOnRep !== undefined,
          actualRpe: input.actualRpe,
          updatedAt: now
        });

        await revalidateActualLastSetTechnique(workoutExerciseId, existingSet.id);

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
      db.workoutExercises,
      db.workouts,
      db.workoutSetMyoSets,
    async () => {
      const setId = await db.workoutSets.add({
        workoutExerciseId,
        setNumber,
        weight: input.weight,
        reps: input.reps,
        failedOnRep: input.failedOnRep,
        isFailure: input.failedOnRep !== undefined,
        actualRpe: input.actualRpe,
        performedAt: now,
        createdAt: now,
        updatedAt: now
      });

      await revalidateActualLastSetTechnique(workoutExerciseId, setId, true);

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
  failedOnRep?: number;
  actualRpe?: number;
  notes?: string;
};

export async function updateHistoricalSet(
  setId: number,
  changes: HistoricalSetChanges
): Promise<void> {
  const set = await db.workoutSets.get(setId);
  if (!set) throw new Error("Set could not be found.");
  validateFailure(changes.reps, changes.failedOnRep, changes.actualRpe);
  await db.transaction("rw", db.workoutSets, db.workoutExercises, db.workoutSetMyoSets, async () => {
    await db.workoutSets.update(setId, { weight: changes.weight, reps: changes.reps, actualRpe: changes.actualRpe,
      failedOnRep: changes.failedOnRep, isFailure: changes.failedOnRep !== undefined,
      notes: changes.notes?.trim() || undefined, updatedAt: nowString() });
    await revalidateActualLastSetTechnique(set.workoutExerciseId, setId);
  });
}

export async function getFinalWorkingSet(workoutExerciseId: number): Promise<WorkoutSet | undefined> {
  const sets = await db.workoutSets.where("workoutExerciseId").equals(workoutExerciseId).toArray();
  return findFinalWorkingSet(sets);
}

async function revalidateActualLastSetTechnique(workoutExerciseId: number, changedSetId?: number, finalSetChanged = false) {
  const workoutExercise = await db.workoutExercises.get(workoutExerciseId);
  if (!workoutExercise?.actualLastSetIntensityTechnique) return;
  const finalSet = await getFinalWorkingSet(workoutExerciseId);
  const validCurrentTechnique = finalSet?.actualRpe === 10 && finalSet.failedOnRep !== undefined;
  const preservedLegacyTechnique = finalSet?.actualRpe === 10 && finalSet.failedOnRep === undefined;
  if (!finalSet || (finalSetChanged && finalSet.id === changedSetId) || (!validCurrentTechnique &&
    (!preservedLegacyTechnique || finalSet.id === changedSetId))) {
    await clearFinalSetAdvancedDetails(workoutExerciseId);
  }
}

export async function updateActualLastSetIntensityTechnique(workoutExerciseId: number, technique: WorkoutExercise["actualLastSetIntensityTechnique"], longLengthPartialReps?: number): Promise<void> {
  const workoutExercise = await db.workoutExercises.get(workoutExerciseId);
  if (!workoutExercise) throw new Error("Workout exercise could not be found.");
  const finalSet = await getFinalWorkingSet(workoutExerciseId);
  if (technique && (!finalSet || finalSet.actualRpe !== 10 || finalSet.failedOnRep === undefined)) throw new Error("An actual technique requires a failed final working set at RPE 10.");
  if (technique === "failure_llps" && (!Number.isInteger(longLengthPartialReps) || longLengthPartialReps! < 1)) throw new Error("Enter a positive whole-number LLP count.");
  await db.transaction("rw", db.workoutExercises, db.workoutSetMyoSets, async () => {
    if (technique !== "myo_reps" && finalSet?.id) await db.workoutSetMyoSets.where("workoutSetId").equals(finalSet.id).delete();
    await db.workoutExercises.update(workoutExerciseId, { actualLastSetIntensityTechnique: technique,
      longLengthPartialReps: technique === "failure_llps" ? longLengthPartialReps : undefined, updatedAt: nowString() });
  });
}

export async function updateLongLengthPartialReps(workoutExerciseId: number, count: number): Promise<void> {
  const workoutExercise = await db.workoutExercises.get(workoutExerciseId);
  if (workoutExercise?.actualLastSetIntensityTechnique !== "failure_llps") {
    throw new Error("Long-length partials can only be recorded with Failure + LLPs.");
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Enter a positive whole-number LLP count.");
  }
  const finalSet = await getFinalWorkingSet(workoutExerciseId);
  if (!finalSet || finalSet.failedOnRep === undefined || finalSet.actualRpe !== 10) {
    throw new Error("Failure + LLPs requires a failed final working set at RPE 10.");
  }
  await db.workoutExercises.update(workoutExerciseId, {
    longLengthPartialReps: count,
    updatedAt: nowString()
  });
}

export async function getMyoSets(workoutSetId: number): Promise<WorkoutSetMyoSet[]> {
  return db.workoutSetMyoSets.where("workoutSetId").equals(workoutSetId).sortBy("order");
}

export async function addMyoSet(workoutSetId: number, reps: number, failedOnRep?: number): Promise<number> {
  validateFailure(reps, failedOnRep, failedOnRep === undefined ? undefined : 10);
  return db.transaction("rw", db.workoutSets, db.workoutExercises, db.workoutSetMyoSets, async () => {
    const main = await db.workoutSets.get(workoutSetId);
    if (!main) throw new Error("Main set could not be found.");
    const exercise = await db.workoutExercises.get(main.workoutExerciseId);
    const final = await getFinalWorkingSet(main.workoutExerciseId);
    if (final?.id !== workoutSetId || exercise?.actualLastSetIntensityTechnique !== "myo_reps") {
      throw new Error("Myo sets belong to the current final Myo-reps set.");
    }
    const rows = await getMyoSets(workoutSetId);
    const now = nowString();
    return db.workoutSetMyoSets.add({ workoutSetId, order: rows.length + 1, reps, failedOnRep, createdAt: now, updatedAt: now });
  });
}

export async function deleteMyoSet(id: number): Promise<void> {
  const row = await db.workoutSetMyoSets.get(id); if (!row) return;
  await db.transaction("rw", db.workoutSetMyoSets, async () => {
    await db.workoutSetMyoSets.delete(id);
    const rows = await getMyoSets(row.workoutSetId);
    for (const [index, item] of rows.entries()) {
      await db.workoutSetMyoSets.update(item.id!, { order: index + 1, updatedAt: nowString() });
    }
  });
}

export async function updateMyoSet(id: number, reps: number, failedOnRep?: number): Promise<void> {
  validateFailure(reps, failedOnRep, failedOnRep === undefined ? undefined : 10);
  const row = await db.workoutSetMyoSets.get(id);
  if (!row) throw new Error("Myo set could not be found.");
  const main = await db.workoutSets.get(row.workoutSetId);
  const exercise = main && await db.workoutExercises.get(main.workoutExerciseId);
  const final = main && await getFinalWorkingSet(main.workoutExerciseId);
  if (!main || final?.id !== main.id || exercise?.actualLastSetIntensityTechnique !== "myo_reps") {
    throw new Error("Myo sets can only be edited on the current final Myo-reps set.");
  }
  await db.workoutSetMyoSets.update(id, { reps, failedOnRep, updatedAt: nowString() });
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
  const wasFinalWorkingSet = set.isWarmup !== true && (await getFinalWorkingSet(set.workoutExerciseId))?.id === setId;

  await db.transaction("rw", db.workoutSets, db.workoutExercises, db.workoutSetMyoSets, async () => {
    await db.workoutSetMyoSets.where("workoutSetId").equals(setId).delete();
    await db.workoutSets.delete(setId);
    if (wasFinalWorkingSet) {
      await clearFinalSetAdvancedDetails(set.workoutExerciseId);
    } else {
      await revalidateActualLastSetTechnique(set.workoutExerciseId);
    }
  });

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

export type FinishWorkoutResult = { workout: Workout; programProgress: "advanced" | "completed" | "mismatch" | "not_applicable" };

export async function finishWorkout(workoutId: number): Promise<FinishWorkoutResult> {
  return db.transaction("rw", [db.workouts, db.workoutExercises, db.workoutSets, db.workoutSetMyoSets,
    db.activeProgramStates, db.programs, db.programWeeks, db.programWorkouts], async () => {
    const workout = await db.workouts.get(workoutId);
    if (!workout || workout.status !== "active") throw new Error("This workout is no longer active.");
    const workoutExercises = await db.workoutExercises.where("workoutId").equals(workoutId).toArray();
    for (const workoutExercise of workoutExercises) {
      if (!workoutExercise.id || workoutExercise.actualLastSetIntensityTechnique !== "myo_reps") continue;
      const finalSet = await getFinalWorkingSet(workoutExercise.id);
      const miniSetCount = finalSet?.id
        ? await db.workoutSetMyoSets.where("workoutSetId").equals(finalSet.id).count()
        : 0;
      if (!miniSetCount) {
        throw new Error("Each Myo-reps technique needs at least one mini-set before the workout can be finished.");
      }
    }
    const now = nowString();
    let programProgress: FinishWorkoutResult["programProgress"] = "not_applicable";
    if (workout.programId && workout.programWeekId && workout.programWorkoutId && !workout.programProgressAppliedAt) {
      programProgress = await advanceActiveProgram({ programId: workout.programId, weekId: workout.programWeekId, workoutId: workout.programWorkoutId });
    }
    const programProgressAppliedAt = programProgress === "advanced" || programProgress === "completed" ? now : workout.programProgressAppliedAt;
    await db.workouts.update(workoutId, { status: "completed", completedAt: now, updatedAt: now, programProgressAppliedAt });
    return { workout: { ...workout, status: "completed", completedAt: now, updatedAt: now, programProgressAppliedAt }, programProgress };
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

export async function updateWorkoutExerciseQualityFlags(
  workoutExerciseId: number,
  qualityFlags: WorkoutExerciseQualityFlag[]
): Promise<void> {
  const workoutExercise = await db.workoutExercises.get(workoutExerciseId);

  if (!workoutExercise) {
    throw new Error("Workout exercise could not be found.");
  }

  const now = nowString();

  await db.transaction("rw", db.workoutExercises, db.workouts, async () => {
    await db.workoutExercises.update(workoutExerciseId, {
      qualityFlags: qualityFlags.length ? qualityFlags : undefined,
      updatedAt: now
    });
    await db.workouts.update(workoutExercise.workoutId, { updatedAt: now });
  });
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
    db.workoutSetMyoSets,
    db.workoutExerciseSubstitutionOptions,
    async () => {
      const setIds = await db.workoutSets.where("workoutExerciseId").equals(workoutExerciseId).primaryKeys();
      if (setIds.length) await db.workoutSetMyoSets.where("workoutSetId").anyOf(setIds).delete();
      await db.workoutSets
        .where("workoutExerciseId")
        .equals(workoutExerciseId)
        .delete();

      await db.workoutExercises.delete(workoutExerciseId);
      await db.workoutExerciseSubstitutionOptions.where("workoutExerciseId").equals(workoutExerciseId).delete();
    }
  );

  await recalculateWorkoutLastSetAt(workoutExercise.workoutId);
}
