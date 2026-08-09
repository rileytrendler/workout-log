import { db } from "../db/db";
import { formatReps } from "./setFormatting";
import { getEffectiveReps } from "./failureSemantics";
import { derivePersonalRecordStatuses } from "./personalRecords";
import { formatSetLoad, getExerciseLoadEntryMode, getTotalExternalLoad } from "./loadFormatting";
import {
  BACKUP_COLLECTIONS,
  CURRENT_BACKUP_VERSION,
  formatBackupValidationErrors,
  normalizeBackup,
  validateBackup,
  type NormalizedWorkoutLogBackup
} from "./backupValidation";

export type WorkoutLogBackup = {
  exportedAt: string;
  appName: "workout-log";
  backupVersion: typeof CURRENT_BACKUP_VERSION;
  data: Record<typeof BACKUP_COLLECTIONS[number], unknown[]>;
};

export async function createBackup(): Promise<WorkoutLogBackup> {
  return db.transaction("r", db.tables, async () => ({
    exportedAt: new Date().toISOString(),
    appName: "workout-log" as const,
    backupVersion: CURRENT_BACKUP_VERSION,
    data: {
      gyms: await db.gyms.toArray(),
      exercises: await db.exercises.toArray(),
      exerciseGymProfiles: await db.exerciseGymProfiles.toArray(),
      workouts: await db.workouts.toArray(),
      workoutExercises: await db.workoutExercises.toArray(),
      workoutSets: await db.workoutSets.toArray(),
      workoutSetMyoSets: await db.workoutSetMyoSets.toArray(),
      workoutTemplates: await db.workoutTemplates.toArray(),
      workoutTemplateExercises: await db.workoutTemplateExercises.toArray(),
      workoutTemplateExerciseSubstitutions: await db.workoutTemplateExerciseSubstitutions.toArray(),
      workoutExerciseSubstitutionOptions: await db.workoutExerciseSubstitutionOptions.toArray(),
      programs: await db.programs.toArray(),
      programWeeks: await db.programWeeks.toArray(),
      programWorkouts: await db.programWorkouts.toArray(),
      programWorkoutExerciseOverrides: await db.programWorkoutExerciseOverrides.toArray(),
      activeProgramStates: await db.activeProgramStates.toArray()
    }
  }));
}

function triggerBackupDownload(backup: WorkoutLogBackup, filename: string) {
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadJsonBackup() {
  const backup = await createBackup();
  triggerBackupDownload(backup, `workout-log-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

export type BackupImportCounts = {
  workouts: number;
  exerciseSessions: number;
  sets: number;
  programs: number;
  templates: number;
  gyms: number;
};

export type PreparedBackupImport = {
  backup: NormalizedWorkoutLogBackup;
  counts: BackupImportCounts;
};

export async function prepareJsonBackup(file: File): Promise<PreparedBackupImport> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    throw new Error(`The selected file is not valid JSON: ${error instanceof Error ? error.message : "parse failed"}`, { cause: error });
  }
  let backup: NormalizedWorkoutLogBackup;
  try {
    backup = normalizeBackup(parsed);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Backup normalization failed.", { cause: error });
  }
  const validation = validateBackup(backup);
  if (!validation.valid) throw new Error(formatBackupValidationErrors(validation.errors));
  return {
    backup,
    counts: {
      workouts: backup.data.workouts.length,
      exerciseSessions: backup.data.workoutExercises.length,
      sets: backup.data.workoutSets.length,
      programs: backup.data.programs.length,
      templates: backup.data.workoutTemplates.length,
      gyms: backup.data.gyms.length
    }
  };
}

const importTables = [
  db.gyms, db.exercises, db.exerciseGymProfiles, db.workouts, db.workoutExercises,
  db.workoutSets, db.workoutSetMyoSets, db.workoutTemplates, db.workoutTemplateExercises,
  db.workoutTemplateExerciseSubstitutions, db.workoutExerciseSubstitutionOptions,
  db.programs, db.programWeeks, db.programWorkouts, db.programWorkoutExerciseOverrides,
  db.activeProgramStates
];

export async function replaceDatabaseWithBackup(backup: NormalizedWorkoutLogBackup) {
  const validation = validateBackup(backup);
  if (!validation.valid) throw new Error(formatBackupValidationErrors(validation.errors));
  const rows = (collection: keyof typeof backup.data) => backup.data[collection] as never[];
  await db.transaction(
    "rw",
    importTables,
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

      await db.gyms.bulkAdd(rows("gyms"));
      await db.exercises.bulkAdd(rows("exercises"));
      await db.exerciseGymProfiles.bulkAdd(rows("exerciseGymProfiles"));
      await db.workoutTemplates.bulkAdd(rows("workoutTemplates"));
      await db.workoutTemplateExercises.bulkAdd(rows("workoutTemplateExercises"));
      await db.workoutTemplateExerciseSubstitutions.bulkAdd(rows("workoutTemplateExerciseSubstitutions"));
      await db.programs.bulkAdd(rows("programs"));
      await db.programWeeks.bulkAdd(rows("programWeeks"));
      await db.programWorkouts.bulkAdd(rows("programWorkouts"));
      await db.programWorkoutExerciseOverrides.bulkAdd(rows("programWorkoutExerciseOverrides"));
      await db.activeProgramStates.bulkAdd(rows("activeProgramStates"));
      await db.workouts.bulkAdd(rows("workouts"));
      await db.workoutExercises.bulkAdd(rows("workoutExercises"));
      await db.workoutExerciseSubstitutionOptions.bulkAdd(rows("workoutExerciseSubstitutionOptions"));
      await db.workoutSets.bulkAdd(rows("workoutSets"));
      await db.workoutSetMyoSets.bulkAdd(rows("workoutSetMyoSets"));
    }
  );
}

function importConfirmation(counts: BackupImportCounts) {
  return [
    "Import this backup?",
    "",
    `${counts.workouts} workouts`,
    `${counts.exerciseSessions} exercise sessions`,
    `${counts.sets} sets`,
    `${counts.programs} Programs`,
    `${counts.templates} Templates`,
    `${counts.gyms} Gyms`,
    "",
    "A safety backup of your current data will be downloaded first. Import replaces all current local data."
  ].join("\n");
}

export async function importJsonBackup(file: File): Promise<{ imported: boolean; safetyBackupDownloadInitiated: boolean }> {
  const candidate = await prepareJsonBackup(file);
  if (!confirm(importConfirmation(candidate.counts))) return { imported: false, safetyBackupDownloadInitiated: false };

  const safetyBackup = await createBackup();
  const safetyValidation = validateBackup(normalizeBackup(safetyBackup));
  if (!safetyValidation.valid) {
    throw new Error(`Import was not applied because the current database could not produce a restorable safety backup.\n${formatBackupValidationErrors(safetyValidation.errors)}`);
  }
  const timestamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  triggerBackupDownload(safetyBackup, `workout-log-pre-import-backup-${timestamp}.json`);
  await replaceDatabaseWithBackup(candidate.backup);
  return { imported: true, safetyBackupDownloadInitiated: true };
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
  const personalRecordStatuses = derivePersonalRecordStatuses({ exercises, workouts, workoutExercises, workoutSets });

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
      "loadEntryMode",
      "prescribedExercise",
      "wasSubstituted",
      "exerciseNotes",
      "qualityFlags",
      "plannedLastSetIntensityTechnique",
      "actualLastSetIntensityTechnique",
      "setNumber",
      "weight",
      "loadExpression",
      "displayWeight",
      "totalExternalLoad",
      "repsCompleted",
      "failedOnRep",
      "effectiveReps",
      "repsDisplay",
      "actualRpe",
      "rir",
      "isWarmup",
      "isFailure",
      "isPR",
      "isSetPR",
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
      getExerciseLoadEntryMode(exercise),
      workoutExercise?.prescribedExerciseNameSnapshot ?? exercise?.name,
      workoutExercise?.prescribedExerciseId !== undefined && workoutExercise.exerciseId !== workoutExercise.prescribedExerciseId,
      workoutExercise?.notes,
      workoutExercise?.qualityFlags?.join("|"),
      workoutExercise?.plannedLastSetIntensityTechnique,
      set.isWarmup !== true && set.setNumber === finalWorkingSetNumber ? workoutExercise?.actualLastSetIntensityTechnique : undefined,
      set.setNumber,
      set.weight,
      set.loadExpression,
      formatSetLoad(set, exercise),
      exercise ? getTotalExternalLoad(exercise, set) : set.weight,
      set.reps,
      set.failedOnRep,
      getEffectiveReps(set),
      formatReps(set),
      set.actualRpe,
      set.rir,
      set.isWarmup,
      set.isFailure,
      set.id !== undefined && personalRecordStatuses.get(set.id)?.isAbsolutePR === true,
      set.id !== undefined && personalRecordStatuses.get(set.id)?.isAbsolutePR !== true &&
        personalRecordStatuses.get(set.id)?.isSetPR === true,
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
