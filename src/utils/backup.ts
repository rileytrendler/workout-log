import { db } from "../db/db";
import { isLastSetIntensityTechnique } from "./intensityTechniques";
import { formatReps } from "./setFormatting";
import { validateStoredRepResult } from "./failureSemantics";

export type WorkoutLogBackup = {
  exportedAt: string;
  appName: "workout-log";
  backupVersion: 1;
  data: {
    gyms: unknown[];
    exercises: unknown[];
    exerciseGymProfiles?: unknown[];
    workouts: unknown[];
    workoutExercises: unknown[];
    workoutSets: unknown[];
    workoutTemplates: unknown[];
    workoutTemplateExercises: unknown[];
    workoutTemplateExerciseSubstitutions?: unknown[];
    workoutExerciseSubstitutionOptions?: unknown[];
    programs?: unknown[];
    programWeeks?: unknown[];
    programWorkouts?: unknown[];
    programWorkoutExerciseOverrides?: unknown[];
    activeProgramStates?: unknown[];
    workoutSetMyoSets?: unknown[];
  };
};

export async function createBackup(): Promise<WorkoutLogBackup> {
  return {
    exportedAt: new Date().toISOString(),
    appName: "workout-log",
    backupVersion: 1,
    data: {
      gyms: await db.gyms.toArray(),
      exercises: await db.exercises.toArray(),
      exerciseGymProfiles: await db.exerciseGymProfiles.toArray(),
      workouts: await db.workouts.toArray(),
      workoutExercises: await db.workoutExercises.toArray(),
      workoutSets: await db.workoutSets.toArray(),
      workoutTemplates: await db.workoutTemplates.toArray(),
      workoutTemplateExercises:
        await db.workoutTemplateExercises.toArray(),
      workoutTemplateExerciseSubstitutions: await db.workoutTemplateExerciseSubstitutions.toArray(),
      workoutExerciseSubstitutionOptions: await db.workoutExerciseSubstitutionOptions.toArray(),
      programs: await db.programs.toArray(),
      programWeeks: await db.programWeeks.toArray(),
      programWorkouts: await db.programWorkouts.toArray(),
      programWorkoutExerciseOverrides: await db.programWorkoutExerciseOverrides.toArray(),
      activeProgramStates: await db.activeProgramStates.toArray(),
      workoutSetMyoSets: await db.workoutSetMyoSets.toArray()
    }
  };
}

export async function downloadJsonBackup() {
  const backup = await createBackup();
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);

  const link = document.createElement("a");
  link.href = url;
  link.download = `workout-log-backup-${date}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

export async function importJsonBackup(file: File) {
  const text = await file.text();
  const parsed = JSON.parse(text) as WorkoutLogBackup;

  if (parsed.appName !== "workout-log" || parsed.backupVersion !== 1) {
    throw new Error("This does not look like a valid workout log backup file.");
  }

  const importedWorkouts = (parsed.data.workouts ?? []).map((workout) => {
    const copy: Record<string, unknown> = {
      ...(workout as Record<string, unknown>),
      status: (workout as Record<string, unknown>).status ?? "completed"
    };
    if (copy.programCycleNumber !== undefined &&
      (!Number.isInteger(copy.programCycleNumber) || Number(copy.programCycleNumber) < 1)) {
      throw new Error("The backup contains an invalid Workout Program cycle snapshot.");
    }
    return copy;
  });
  const cleanTechnique = (row: unknown, field: string, allowNull = false) => {
    const copy = { ...(row as Record<string, unknown>) };
    const value = copy[field];
    if (value !== undefined && !(allowNull && value === null) && !isLastSetIntensityTechnique(value)) delete copy[field];
    return copy;
  };
  const importedTemplateExercises = (parsed.data.workoutTemplateExercises ?? []).map(row => cleanTechnique(row, "plannedLastSetIntensityTechnique"));
  const importedOverrides = (parsed.data.programWorkoutExerciseOverrides ?? []).map(row => cleanTechnique(row, "plannedLastSetIntensityTechnique", true));
  const importedSets = (parsed.data.workoutSets ?? []).map((row, index) => {
    const copy = { ...(row as Record<string, unknown>) };
    if (typeof copy.failedOnRep === "number" && Number.isInteger(copy.failedOnRep) && copy.failedOnRep >= 1 &&
      copy.reps === copy.failedOnRep && copy.actualRpe === 10) {
      copy.reps = copy.failedOnRep - 1;
      copy.isFailure = true;
    }
    if (copy.reps !== undefined || copy.failedOnRep !== undefined) {
      const error = validateStoredRepResult(copy, true);
      if (error) {
        throw new Error(`The backup contains an invalid workout set (${String(copy.id ?? index + 1)}): ${error}.`);
      }
    }
    return copy;
  });
  const importedWorkoutExercises = (parsed.data.workoutExercises ?? []).map(row => {
    const copy = cleanTechnique(cleanTechnique(row, "plannedLastSetIntensityTechnique"), "actualLastSetIntensityTechnique");
    if (copy.actualLastSetIntensityTechnique !== undefined) {
      const finalSet = importedSets
        .map(set => set as Record<string, unknown>)
        .filter(set => set.workoutExerciseId === copy.id && set.isWarmup !== true)
        .sort((a, b) => Number(b.setNumber) - Number(a.setNumber))[0];
      if (!finalSet || finalSet.actualRpe !== 10) {
        delete copy.actualLastSetIntensityTechnique;
        delete copy.longLengthPartialReps;
      }
    }
    if (copy.longLengthPartialReps !== undefined &&
      (copy.actualLastSetIntensityTechnique !== "failure_llps" || !Number.isInteger(copy.longLengthPartialReps) || Number(copy.longLengthPartialReps) < 1)) {
      throw new Error("The backup contains invalid long-length partial data.");
    }
    return copy;
  });
  const templateSubstitutionRows = (parsed.data.workoutTemplateExerciseSubstitutions ?? []) as Array<Record<string, unknown>>;
  const workoutOptionRows = (parsed.data.workoutExerciseSubstitutionOptions ?? []) as Array<Record<string, unknown>>;
  const exerciseRows = (parsed.data.exercises ?? []) as Array<Record<string, unknown>>;
  const templateExerciseRows = importedTemplateExercises as Array<Record<string, unknown>>;
  const exerciseIds = new Set(exerciseRows.map(row => row.id));
  const templateExerciseById = new Map(templateExerciseRows.map(row => [row.id, row]));
  const workoutExerciseIds = new Set(importedWorkoutExercises.map(row => row.id));
  const importedWorkoutExerciseById = new Map(importedWorkoutExercises.map(row => [row.id, row]));
  for (const row of importedWorkoutExercises) {
    if (row.prescribedExerciseId !== undefined &&
      (typeof row.prescribedExerciseNameSnapshot !== "string" || !row.prescribedExerciseNameSnapshot.trim())) {
      throw new Error("The backup contains workout provenance without a prescribed exercise name snapshot.");
    }
  }
  const templateOptionKeys = new Set<string>();
  const templateOrders = new Map<unknown, number[]>();
  for (const row of templateSubstitutionRows) {
    const source = templateExerciseById.get(row.templateExerciseId);
    const order = Number(row.order);
    if (!source || !exerciseIds.has(row.substituteExerciseId) || source.exerciseId === row.substituteExerciseId || !Number.isInteger(order) || order < 1) {
      throw new Error("The backup contains an invalid template exercise substitution.");
    }
    const key = `${String(row.templateExerciseId)}:${String(row.substituteExerciseId)}`;
    if (templateOptionKeys.has(key)) throw new Error("The backup contains duplicate template exercise substitutions.");
    templateOptionKeys.add(key);
    templateOrders.set(row.templateExerciseId, [...(templateOrders.get(row.templateExerciseId) ?? []), order]);
  }
  for (const orders of templateOrders.values()) {
    orders.sort((a, b) => a - b);
    if (orders.some((order, index) => order !== index + 1)) throw new Error("Template substitution order must be contiguous.");
  }
  const workoutOptionKeys = new Set<string>();
  const workoutOptionOrders = new Map<unknown, number[]>();
  for (const row of workoutOptionRows) {
    const order = Number(row.order);
    const workoutExercise = importedWorkoutExerciseById.get(row.workoutExerciseId);
    if (!workoutExerciseIds.has(row.workoutExerciseId) || !exerciseIds.has(row.exerciseId) ||
      workoutExercise?.prescribedExerciseId === row.exerciseId ||
      typeof row.exerciseNameSnapshot !== "string" || !row.exerciseNameSnapshot.trim() || !Number.isInteger(order) || order < 1) {
      throw new Error("The backup contains an invalid workout substitution snapshot.");
    }
    const key = `${String(row.workoutExerciseId)}:${String(row.exerciseId)}`;
    if (workoutOptionKeys.has(key)) throw new Error("The backup contains duplicate workout substitution choices.");
    workoutOptionKeys.add(key);
    workoutOptionOrders.set(row.workoutExerciseId, [...(workoutOptionOrders.get(row.workoutExerciseId) ?? []), order]);
  }
  for (const orders of workoutOptionOrders.values()) {
    orders.sort((a, b) => a - b);
    if (orders.some((order, index) => order !== index + 1)) throw new Error("Workout substitution choice order must be contiguous.");
  }
  const setIds = new Set(importedSets.map(row => row.id));
  const setById = new Map(importedSets.map(row => [row.id, row]));
  const workoutExerciseById = new Map(importedWorkoutExercises.map(row => [row.id, row]));
  const myoRows = (parsed.data.workoutSetMyoSets ?? []) as Array<Record<string, unknown>>;
  const myoByMainSet = new Map<unknown, Array<Record<string, unknown>>>();
  for (const [index, row] of myoRows.entries()) {
    if (typeof row.failedOnRep === "number" && Number.isInteger(row.failedOnRep) && row.failedOnRep >= 1 &&
      row.reps === row.failedOnRep) {
      row.reps = row.failedOnRep - 1;
    }
    const order = Number(row.order);
    if (!setIds.has(row.workoutSetId) || !Number.isInteger(order) || order < 1) {
      throw new Error("The backup contains invalid or orphaned Myo-rep data.");
    }
    const repError = validateStoredRepResult(row, false);
    if (repError) {
      throw new Error(`The backup contains an invalid Myo-rep mini-set (${String(row.id ?? index + 1)}): ${repError}.`);
    }
    const mainSet = setById.get(row.workoutSetId);
    const workoutExercise = mainSet && workoutExerciseById.get(mainSet.workoutExerciseId);
    const finalSet = workoutExercise && importedSets
      .filter(set => set.workoutExerciseId === workoutExercise.id && set.isWarmup !== true)
      .sort((a, b) => Number(b.setNumber) - Number(a.setNumber))[0];
    if (!mainSet || finalSet?.id !== mainSet.id || workoutExercise?.actualLastSetIntensityTechnique !== "myo_reps") {
      throw new Error("Myo-rep data must belong to the final set of a Myo-reps exercise.");
    }
    const grouped = myoByMainSet.get(row.workoutSetId) ?? [];
    grouped.push(row);
    myoByMainSet.set(row.workoutSetId, grouped);
  }
  for (const rows of myoByMainSet.values()) {
    const orders = rows.map(row => Number(row.order)).sort((a, b) => a - b);
    if (orders.some((order, index) => order !== index + 1)) {
      throw new Error("Myo-rep mini-set order must be unique and contiguous.");
    }
  }
  if (parsed.data.workoutSetMyoSets !== undefined) {
    for (const workoutExercise of importedWorkoutExercises) {
      if (workoutExercise.actualLastSetIntensityTechnique !== "myo_reps") continue;
      const finalSet = importedSets.filter(set => set.workoutExerciseId === workoutExercise.id && set.isWarmup !== true)
        .sort((a, b) => Number(b.setNumber) - Number(a.setNumber))[0];
      if (finalSet?.failedOnRep !== undefined && !myoByMainSet.get(finalSet.id)?.length) {
        throw new Error("A recorded Myo-reps technique must include at least one mini-set.");
      }
    }
  }
  if (importedWorkouts.filter((workout) => workout.status === "active").length > 1) {
    throw new Error("This backup contains more than one active workout and cannot be imported safely.");
  }
  const importedActiveProgramStates = (parsed.data.activeProgramStates ?? []).map(row => {
    const copy = { ...(row as Record<string, unknown>) };
    if (copy.cycleNumber === undefined) copy.cycleNumber = 1;
    if (!Number.isInteger(copy.cycleNumber) || Number(copy.cycleNumber) < 1) {
      throw new Error("The backup contains an invalid active Program cycle.");
    }
    return copy;
  });
  if (importedActiveProgramStates.length > 1) throw new Error("This backup contains more than one active Program and cannot be imported safely.");
  if (importedActiveProgramStates.length) {
    const state = importedActiveProgramStates[0] as Record<string, unknown>;
    const programs = parsed.data.programs ?? [], weeks = parsed.data.programWeeks ?? [], slots = parsed.data.programWorkouts ?? [];
    const program = programs.find(row => (row as Record<string, unknown>).id === state.programId) as Record<string, unknown> | undefined;
    const week = weeks.find(row => (row as Record<string, unknown>).id === state.currentProgramWeekId) as Record<string, unknown> | undefined;
    const slot = slots.find(row => (row as Record<string, unknown>).id === state.currentProgramWorkoutId) as Record<string, unknown> | undefined;
    if (!program || !week || !slot || week.programId !== state.programId || slot.programWeekId !== state.currentProgramWeekId) throw new Error("The active Program progress in this backup has invalid references.");
  }

  const confirmed = confirm("Importing this backup will replace all current local workout data. Continue?");

  if (!confirmed) return;

  await db.transaction(
    "rw",
    [
      db.gyms,
      db.exercises,
      db.exerciseGymProfiles,
      db.workouts,
      db.workoutExercises,
      db.workoutSets,
      db.workoutTemplates,
      db.workoutTemplateExercises,
      db.workoutTemplateExerciseSubstitutions,
      db.workoutExerciseSubstitutionOptions,
      db.programs,
      db.programWeeks,
      db.programWorkouts,
      db.programWorkoutExerciseOverrides,
      db.activeProgramStates,
      db.workoutSetMyoSets
    ],
    async () => {
      await db.programWorkoutExerciseOverrides.clear();
      await db.activeProgramStates.clear();
      await db.programWorkouts.clear();
      await db.programWeeks.clear();
      await db.programs.clear();
      await db.workoutTemplateExercises.clear();
      await db.workoutTemplateExerciseSubstitutions.clear();
      await db.workoutExerciseSubstitutionOptions.clear();
      await db.workoutSetMyoSets.clear();
      await db.workoutTemplates.clear();
      await db.workoutSets.clear();
      await db.workoutExercises.clear();
      await db.workouts.clear();
      await db.exerciseGymProfiles.clear();
      await db.exercises.clear();
      await db.gyms.clear();

      await db.gyms.bulkAdd((parsed.data.gyms ?? []) as never[]);
      await db.exercises.bulkAdd(parsed.data.exercises as never[]);
      await db.exerciseGymProfiles.bulkAdd(
        (parsed.data.exerciseGymProfiles ?? []) as never[]
      );

      await db.workoutTemplates.bulkAdd(
        (parsed.data.workoutTemplates ?? []) as never[]
      );

      await db.workoutTemplateExercises.bulkAdd(
        importedTemplateExercises as never[]
      );
      await db.workoutTemplateExerciseSubstitutions.bulkAdd(templateSubstitutionRows as never[]);

      await db.programs.bulkAdd((parsed.data.programs ?? []) as never[]);
      await db.programWeeks.bulkAdd((parsed.data.programWeeks ?? []) as never[]);
      await db.programWorkouts.bulkAdd((parsed.data.programWorkouts ?? []) as never[]);
      await db.programWorkoutExerciseOverrides.bulkAdd(importedOverrides as never[]);
      await db.activeProgramStates.bulkAdd(importedActiveProgramStates as never[]);

      await db.workouts.bulkAdd(importedWorkouts as never[]);

      await db.workoutExercises.bulkAdd(
        importedWorkoutExercises as never[]
      );
      await db.workoutExerciseSubstitutionOptions.bulkAdd(workoutOptionRows as never[]);

      await db.workoutSets.bulkAdd(
        importedSets as never[]
      );
      await db.workoutSetMyoSets.bulkAdd(myoRows as never[]);
    }
  );
}

function csvEscape(value: unknown) {
  if (value === undefined || value === null) return "";

  const text = String(value);

  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

export async function downloadSetsCsv() {
  const gyms = await db.gyms.toArray();
  const workouts = await db.workouts.toArray();
  const workoutExercises = await db.workoutExercises.toArray();
  const workoutSets = await db.workoutSets.toArray();
  const exercises = await db.exercises.toArray();
  const myoSets = await db.workoutSetMyoSets.toArray();

  const workoutById = new Map(workouts.map((workout) => [workout.id, workout]));
  const workoutExerciseById = new Map(workoutExercises.map((workoutExercise) => [workoutExercise.id, workoutExercise]));
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const gymById = new Map(gyms.map((gym) => [gym.id, gym]));

  const rows: unknown[][] = [
    [
      "workoutDate",
      "workoutTitle",
      "gymName",
      "workoutNotes",
      "workoutStartTime",
      "workoutLastSetAt",
      "workoutStatus",
      "workoutCompletedAt",
      "programName",
      "programCycle",
      "programWeek",
      "programWorkout",
      "exerciseName",
      "prescribedExercise",
      "wasSubstituted",
      "exerciseNotes",
      "plannedLastSetIntensityTechnique",
      "actualLastSetIntensityTechnique",
      "setNumber",
      "weight",
      "repsCompleted",
      "failedOnRep",
      "repsDisplay",
      "actualRpe",
      "rir",
      "isWarmup",
      "isFailure",
      "longLengthPartialReps",
      "myoMiniSets",
      "setNotes",
      "performedAt",
      "setCreatedAt",
      "setUpdatedAt"
    ]
  ];

  const sortedSets = [...workoutSets].sort((a, b) => {
    const aWorkoutExercise = workoutExerciseById.get(a.workoutExerciseId);
    const bWorkoutExercise = workoutExerciseById.get(b.workoutExerciseId);

    const aWorkout = aWorkoutExercise ? workoutById.get(aWorkoutExercise.workoutId) : undefined;
    const bWorkout = bWorkoutExercise ? workoutById.get(bWorkoutExercise.workoutId) : undefined;

    const aDate = aWorkout?.date ?? "";
    const bDate = bWorkout?.date ?? "";

    if (aDate !== bDate) return aDate.localeCompare(bDate);

    const aOrder = aWorkoutExercise?.order ?? 0;
    const bOrder = bWorkoutExercise?.order ?? 0;

    if (aOrder !== bOrder) return aOrder - bOrder;

    return a.setNumber - b.setNumber;
  });

  for (const set of sortedSets) {
    const workoutExercise = workoutExerciseById.get(set.workoutExerciseId);
    const workout = workoutExercise ? workoutById.get(workoutExercise.workoutId) : undefined;
    const exercise = workoutExercise ? exerciseById.get(workoutExercise.exerciseId) : undefined;
    const finalWorkingSetNumber = workoutExercise
      ? Math.max(...workoutSets.filter(candidate => candidate.workoutExerciseId === workoutExercise.id && candidate.isWarmup !== true).map(candidate => candidate.setNumber), -1)
      : -1;

    rows.push([
      workout?.date,
      workout?.title,
      workout?.gymId === undefined ? "" : (gymById.get(workout.gymId)?.name ?? "Unknown gym"),
      workout?.notes,
      workout?.startTime,
      workout?.lastSetAt,
      workout?.status ?? "completed",
      workout?.completedAt,
      workout?.programNameSnapshot,
      workout?.programCycleNumber,
      workout?.programWeekLabelSnapshot,
      workout?.programWorkoutNameSnapshot,
      exercise?.name,
      workoutExercise?.prescribedExerciseNameSnapshot ?? exercise?.name,
      workoutExercise?.prescribedExerciseId !== undefined && workoutExercise.exerciseId !== workoutExercise.prescribedExerciseId,
      workoutExercise?.notes,
      workoutExercise?.plannedLastSetIntensityTechnique,
      set.isWarmup !== true && set.setNumber === finalWorkingSetNumber ? workoutExercise?.actualLastSetIntensityTechnique : undefined,
      set.setNumber,
      set.weight,
      set.reps,
      set.failedOnRep,
      formatReps(set),
      set.actualRpe,
      set.rir,
      set.isWarmup,
      set.isFailure,
      set.isWarmup !== true && set.setNumber === finalWorkingSetNumber ? workoutExercise?.longLengthPartialReps : undefined,
      set.id && set.isWarmup !== true && set.setNumber === finalWorkingSetNumber
        ? myoSets.filter(row => row.workoutSetId === set.id).sort((a, b) => a.order - b.order).map(formatReps).join("|") : undefined,
      set.notes,
      set.performedAt ?? set.createdAt,
      set.createdAt,
      set.updatedAt
    ]);
  }

  const date = new Date().toISOString().slice(0, 10);
  downloadCsv(`workout-log-sets-${date}.csv`, rows);
}
