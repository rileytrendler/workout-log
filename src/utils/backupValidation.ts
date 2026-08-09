import { isLastSetIntensityTechnique } from "./intensityTechniques";
import { validateStoredRepResult } from "./failureSemantics";
import { isWorkoutExerciseQualityFlag } from "./qualityFlags";

export const CURRENT_BACKUP_VERSION = 2 as const;
export const SUPPORTED_BACKUP_VERSIONS = [1, CURRENT_BACKUP_VERSION] as const;

/**
 * Backup version 2 contains every table in Dexie schema version 13. Version 1
 * is normalized on import because collections and fields were added over time.
 * This version is intentionally independent from the Dexie schema version.
 */
export const BACKUP_COLLECTIONS = [
  "gyms",
  "exercises",
  "exerciseGymProfiles",
  "workouts",
  "workoutExercises",
  "workoutSets",
  "workoutSetMyoSets",
  "workoutTemplates",
  "workoutTemplateExercises",
  "workoutTemplateExerciseSubstitutions",
  "workoutExerciseSubstitutionOptions",
  "programs",
  "programWeeks",
  "programWorkouts",
  "programWorkoutExerciseOverrides",
  "activeProgramStates"
] as const;

export type BackupCollectionName = typeof BACKUP_COLLECTIONS[number];
export type BackupRow = Record<string, unknown>;
export type NormalizedBackupData = Record<BackupCollectionName, BackupRow[]>;

export type NormalizedWorkoutLogBackup = {
  appName: "workout-log";
  backupVersion: typeof CURRENT_BACKUP_VERSION;
  sourceBackupVersion: 1 | 2;
  exportedAt?: string;
  sourceCollections: ReadonlySet<BackupCollectionName>;
  data: NormalizedBackupData;
};

export type BackupValidationError = {
  collection: BackupCollectionName | "backup";
  rowId?: unknown;
  message: string;
};

export type BackupValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: BackupValidationError[] };

const LEGACY_REQUIRED_COLLECTIONS: readonly BackupCollectionName[] = [
  "gyms", "exercises", "workouts", "workoutExercises", "workoutSets",
  "workoutTemplates", "workoutTemplateExercises"
];

function isRecord(value: unknown): value is BackupRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copyRows(value: unknown, collection: BackupCollectionName): BackupRow[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${collection} must be an array.`);
  return value.map((row, index) => {
    if (!isRecord(row)) throw new Error(`${collection} row ${index + 1} must be an object.`);
    return { ...row };
  });
}

function normalizeLegacyFailure(row: BackupRow, requireRpe: boolean) {
  if (Number.isInteger(row.failedOnRep) && Number(row.failedOnRep) >= 1 &&
    row.reps === row.failedOnRep && (!requireRpe || row.actualRpe === 10)) {
    row.reps = Number(row.failedOnRep) - 1;
    if (requireRpe) row.isFailure = true;
  }
}

function cleanLegacyTechnique(row: BackupRow, field: string, allowNull = false) {
  const value = row[field];
  if (value !== undefined && !(allowNull && value === null) && !isLastSetIntensityTechnique(value)) {
    delete row[field];
  }
}

export function normalizeBackup(value: unknown): NormalizedWorkoutLogBackup {
  if (!isRecord(value) || value.appName !== "workout-log" || !isRecord(value.data)) {
    throw new Error("This does not look like a workout-log JSON backup.");
  }
  const sourceData = value.data;
  const version = value.backupVersion;
  if (version !== 1 && version !== CURRENT_BACKUP_VERSION) {
    throw new Error(`Unsupported backup version ${String(version)}. This app accepts versions 1 and ${CURRENT_BACKUP_VERSION}.`);
  }

  const sourceCollections = new Set<BackupCollectionName>();
  const data = Object.fromEntries(BACKUP_COLLECTIONS.map((collection) => {
    if (Object.hasOwn(sourceData, collection)) sourceCollections.add(collection);
    return [collection, copyRows(sourceData[collection], collection)];
  })) as NormalizedBackupData;

  for (const exercise of data.exercises) {
    if (exercise.measurementType === undefined) exercise.measurementType = "weight_reps";
  }
  for (const workout of data.workouts) {
    if (workout.status === undefined) workout.status = "completed";
  }
  for (const workoutExercise of data.workoutExercises) {
    if (workoutExercise.qualityFlags === undefined) delete workoutExercise.qualityFlags;
  }
  for (const state of data.activeProgramStates) {
    if (state.cycleNumber === undefined) state.cycleNumber = 1;
  }

  if (version === 1) {
    data.workoutSets.forEach((row) => normalizeLegacyFailure(row, true));
    data.workoutSetMyoSets.forEach((row) => normalizeLegacyFailure(row, false));
    data.workoutTemplateExercises.forEach((row) => cleanLegacyTechnique(row, "plannedLastSetIntensityTechnique"));
    data.programWorkoutExerciseOverrides.forEach((row) => cleanLegacyTechnique(row, "plannedLastSetIntensityTechnique", true));
    data.workoutExercises.forEach((row) => {
      cleanLegacyTechnique(row, "plannedLastSetIntensityTechnique");
      cleanLegacyTechnique(row, "actualLastSetIntensityTechnique");
      if (row.actualLastSetIntensityTechnique !== undefined) {
        const finalSet = data.workoutSets.filter((set) =>
          set.workoutExerciseId === row.id && set.isWarmup !== true)
          .sort((a, b) => Number(b.setNumber) - Number(a.setNumber))[0];
        if (!finalSet || finalSet.actualRpe !== 10) {
          delete row.actualLastSetIntensityTechnique;
          delete row.longLengthPartialReps;
        }
      }
    });
  }

  return {
    appName: "workout-log",
    backupVersion: CURRENT_BACKUP_VERSION,
    sourceBackupVersion: version,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : undefined,
    sourceCollections,
    data
  };
}

type ValidationContext = {
  backup: NormalizedWorkoutLogBackup;
  errors: BackupValidationError[];
  ids: Record<BackupCollectionName, Set<number>>;
  rowsById: Record<BackupCollectionName, Map<number, BackupRow>>;
};

function addError(context: ValidationContext, collection: BackupValidationError["collection"], row: BackupRow | undefined, message: string) {
  context.errors.push({ collection, rowId: row?.id, message });
}

function label(collection: BackupCollectionName) {
  const singular: Record<BackupCollectionName, string> = {
    gyms: "Gym", exercises: "Exercise", exerciseGymProfiles: "ExerciseGymProfile",
    workouts: "Workout", workoutExercises: "WorkoutExercise", workoutSets: "WorkoutSet",
    workoutSetMyoSets: "WorkoutSetMyoSet", workoutTemplates: "WorkoutTemplate",
    workoutTemplateExercises: "WorkoutTemplateExercise",
    workoutTemplateExerciseSubstitutions: "Template substitution",
    workoutExerciseSubstitutionOptions: "Workout substitution option", programs: "Program",
    programWeeks: "ProgramWeek", programWorkouts: "ProgramWorkout",
    programWorkoutExerciseOverrides: "ProgramWorkoutExerciseOverride",
    activeProgramStates: "ActiveProgramState"
  };
  return singular[collection];
}

function requireId(context: ValidationContext, collection: BackupCollectionName, row: BackupRow, index: number) {
  if (!Number.isInteger(row.id) || Number(row.id) < 1) {
    addError(context, collection, row, `${label(collection)} row ${index + 1}: id must be a positive whole number`);
    return;
  }
  const id = Number(row.id);
  if (context.ids[collection].has(id)) {
    addError(context, collection, row, `duplicate primary id ${id}`);
    return;
  }
  context.ids[collection].add(id);
  context.rowsById[collection].set(id, row);
}

function requireParent(context: ValidationContext, collection: BackupCollectionName, row: BackupRow,
  field: string, parent: BackupCollectionName, optional = false) {
  const value = row[field];
  if (optional && value === undefined) return;
  if (!Number.isInteger(value) || !context.ids[parent].has(Number(value))) {
    addError(context, collection, row, `${field} references missing ${label(parent)} ${String(value)}`);
  }
}

function requireNonBlank(context: ValidationContext, collection: BackupCollectionName, row: BackupRow, field: string) {
  if (typeof row[field] !== "string" || !String(row[field]).trim()) {
    addError(context, collection, row, `${field} must be a non-blank string`);
  }
}

function optionalFinite(context: ValidationContext, collection: BackupCollectionName, row: BackupRow, field: string,
  options: { integer?: boolean; min?: number; max?: number } = {}) {
  const value = row[field];
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) ||
    (options.integer && !Number.isInteger(value)) ||
    (options.min !== undefined && value < options.min) ||
    (options.max !== undefined && value > options.max)) {
    const bounds = options.min !== undefined || options.max !== undefined
      ? ` between ${String(options.min ?? "-∞")} and ${String(options.max ?? "∞")}` : "";
    addError(context, collection, row, `${field} must be a${options.integer ? " whole" : " finite"} number${bounds}`);
  }
}

function validateOrder(context: ValidationContext, collection: BackupCollectionName, row: BackupRow) {
  optionalFinite(context, collection, row, "order", { integer: true, min: 1 });
}

function validateUnique(context: ValidationContext, collection: BackupCollectionName, fields: string[], message: string) {
  const seen = new Set<string>();
  for (const row of context.backup.data[collection]) {
    const key = fields.map((field) => String(row[field])).join(":");
    if (seen.has(key)) addError(context, collection, row, message.replace("{key}", key));
    seen.add(key);
  }
}

function validateContiguous(context: ValidationContext, collection: BackupCollectionName, parentField: string) {
  const grouped = new Map<unknown, BackupRow[]>();
  for (const row of context.backup.data[collection]) {
    const rows = grouped.get(row[parentField]) ?? [];
    rows.push(row);
    grouped.set(row[parentField], rows);
  }
  for (const rows of grouped.values()) {
    const orders = rows.map((row) => row.order).filter((order): order is number => Number.isInteger(order)).sort((a, b) => a - b);
    if (orders.length === rows.length && orders.some((order, index) => order !== index + 1)) {
      addError(context, collection, rows[0], `order must be unique and contiguous from 1 within ${parentField} ${String(rows[0][parentField])}`);
    }
  }
}

function validatePrescription(context: ValidationContext, collection: BackupCollectionName, row: BackupRow) {
  optionalFinite(context, collection, row, "plannedSetCount", { integer: true, min: 1 });
  optionalFinite(context, collection, row, "targetMinReps", { integer: true, min: 0 });
  optionalFinite(context, collection, row, "targetMaxReps", { integer: true, min: 0 });
  optionalFinite(context, collection, row, "targetRpeMin", { min: 0, max: 10 });
  optionalFinite(context, collection, row, "targetRpeMax", { min: 0, max: 10 });
  optionalFinite(context, collection, row, "targetRestSeconds", { min: 0 });
  if (typeof row.targetMinReps === "number" && typeof row.targetMaxReps === "number" && row.targetMinReps > row.targetMaxReps) {
    addError(context, collection, row, "targetMinReps cannot exceed targetMaxReps");
  }
  if (typeof row.targetRpeMin === "number" && typeof row.targetRpeMax === "number" && row.targetRpeMin > row.targetRpeMax) {
    addError(context, collection, row, "targetRpeMin cannot exceed targetRpeMax");
  }
}

function validateTechnique(context: ValidationContext, collection: BackupCollectionName, row: BackupRow, field: string, allowNull = false) {
  const value = row[field];
  if (value !== undefined && !(allowNull && value === null) && !isLastSetIntensityTechnique(value)) {
    addError(context, collection, row, `${field} has unsupported value ${String(value)}`);
  }
}

function validateWorkoutSets(context: ValidationContext) {
  const exerciseById = context.rowsById.exercises;
  const workoutExerciseById = context.rowsById.workoutExercises;
  for (const row of context.backup.data.workoutSets) {
    requireParent(context, "workoutSets", row, "workoutExerciseId", "workoutExercises");
    optionalFinite(context, "workoutSets", row, "setNumber", { integer: true, min: 1 });
    optionalFinite(context, "workoutSets", row, "actualRpe", { min: 0, max: 10 });
    optionalFinite(context, "workoutSets", row, "rir", { min: 0 });
    optionalFinite(context, "workoutSets", row, "weight");
    const repError = validateStoredRepResult(row, true);
    if (repError) addError(context, "workoutSets", row, repError);
    if (row.isFailure !== undefined && row.isFailure !== (row.failedOnRep !== undefined)) {
      addError(context, "workoutSets", row, "isFailure must match whether failedOnRep is present");
    }
    const workoutExercise = workoutExerciseById.get(Number(row.workoutExerciseId));
    const exercise = workoutExercise && exerciseById.get(Number(workoutExercise.exerciseId));
    const measurementType = exercise?.measurementType ?? "weight_reps";
    if (measurementType === "weight_reps" && (typeof row.weight !== "number" || !Number.isFinite(row.weight))) {
      addError(context, "workoutSets", row, "weight is required for a weight-and-reps exercise");
    }
  }
  validateUnique(context, "workoutSets", ["workoutExerciseId", "setNumber"], "duplicate setNumber for WorkoutExercise ({key})");
}

function validateMyoSets(context: ValidationContext) {
  const setsByExercise = new Map<number, BackupRow[]>();
  for (const set of context.backup.data.workoutSets) {
    const rows = setsByExercise.get(Number(set.workoutExerciseId)) ?? [];
    rows.push(set);
    setsByExercise.set(Number(set.workoutExerciseId), rows);
  }
  for (const row of context.backup.data.workoutSetMyoSets) {
    requireParent(context, "workoutSetMyoSets", row, "workoutSetId", "workoutSets");
    validateOrder(context, "workoutSetMyoSets", row);
    const repError = validateStoredRepResult(row, false);
    if (repError) addError(context, "workoutSetMyoSets", row, repError);
    const mainSet = context.rowsById.workoutSets.get(Number(row.workoutSetId));
    const workoutExercise = mainSet && context.rowsById.workoutExercises.get(Number(mainSet.workoutExerciseId));
    const finalSet = workoutExercise && [...(setsByExercise.get(Number(workoutExercise.id)) ?? [])]
      .filter((set) => set.isWarmup !== true).sort((a, b) => Number(b.setNumber) - Number(a.setNumber))[0];
    if (mainSet && (finalSet?.id !== mainSet.id || workoutExercise?.actualLastSetIntensityTechnique !== "myo_reps")) {
      addError(context, "workoutSetMyoSets", row, "must belong to the final working set of a Myo-reps WorkoutExercise");
    }
  }
  validateUnique(context, "workoutSetMyoSets", ["workoutSetId", "order"], "duplicate Myo mini-set order ({key})");
  validateContiguous(context, "workoutSetMyoSets", "workoutSetId");
}

function validateWorkoutExerciseTechniques(context: ValidationContext) {
  const setsByExercise = new Map<number, BackupRow[]>();
  const myoParentIds = new Set(context.backup.data.workoutSetMyoSets.map((row) => row.workoutSetId));
  for (const set of context.backup.data.workoutSets) {
    const rows = setsByExercise.get(Number(set.workoutExerciseId)) ?? [];
    rows.push(set);
    setsByExercise.set(Number(set.workoutExerciseId), rows);
  }
  for (const row of context.backup.data.workoutExercises) {
    const technique = row.actualLastSetIntensityTechnique;
    if (technique === undefined) {
      if (row.longLengthPartialReps !== undefined) addError(context, "workoutExercises", row, "longLengthPartialReps requires failure_llps");
      continue;
    }
    const finalSet = [...(setsByExercise.get(Number(row.id)) ?? [])]
      .filter((set) => set.isWarmup !== true).sort((a, b) => Number(b.setNumber) - Number(a.setNumber))[0];
    const legacyPreserved = context.backup.sourceBackupVersion === 1 && finalSet?.actualRpe === 10 && finalSet.failedOnRep === undefined;
    if (!finalSet || finalSet.actualRpe !== 10 || (finalSet.failedOnRep === undefined && !legacyPreserved)) {
      addError(context, "workoutExercises", row, "actualLastSetIntensityTechnique requires a failed final working set at RPE 10");
    }
    if (technique === "failure_llps") {
      optionalFinite(context, "workoutExercises", row, "longLengthPartialReps", { integer: true, min: 1 });
      if (row.longLengthPartialReps === undefined) addError(context, "workoutExercises", row, "failure_llps requires longLengthPartialReps");
    } else if (row.longLengthPartialReps !== undefined) {
      addError(context, "workoutExercises", row, "longLengthPartialReps is only valid with failure_llps");
    }
    if (technique === "myo_reps" && context.backup.sourceCollections.has("workoutSetMyoSets") &&
      finalSet?.id !== undefined && !myoParentIds.has(finalSet.id)) {
      addError(context, "workoutExercises", row, "Myo-reps requires at least one mini-set on the final working set");
    }
  }
}

export function validateBackup(backup: NormalizedWorkoutLogBackup): BackupValidationResult {
  const ids = Object.fromEntries(BACKUP_COLLECTIONS.map((name) => [name, new Set<number>()])) as ValidationContext["ids"];
  const rowsById = Object.fromEntries(BACKUP_COLLECTIONS.map((name) => [name, new Map<number, BackupRow>()])) as ValidationContext["rowsById"];
  const context: ValidationContext = { backup, errors: [], ids, rowsById };

  const requiredCollections = backup.sourceBackupVersion === CURRENT_BACKUP_VERSION
    ? BACKUP_COLLECTIONS : LEGACY_REQUIRED_COLLECTIONS;
  for (const collection of requiredCollections) {
    if (!backup.sourceCollections.has(collection)) addError(context, "backup", undefined, `missing required ${collection} collection`);
  }

  for (const collection of BACKUP_COLLECTIONS) {
    backup.data[collection].forEach((row, index) => requireId(context, collection, row, index));
  }

  for (const row of backup.data.gyms) requireNonBlank(context, "gyms", row, "name");
  for (const row of backup.data.exercises) {
    requireNonBlank(context, "exercises", row, "name");
    if (row.defaultUnit !== "lb" && row.defaultUnit !== "kg") addError(context, "exercises", row, "defaultUnit must be lb or kg");
    if (!["weight_reps", "reps_only", "bodyweight_added_weight"].includes(String(row.measurementType))) {
      addError(context, "exercises", row, `measurementType has unsupported value ${String(row.measurementType)}`);
    }
    optionalFinite(context, "exercises", row, "defaultRestSeconds", { min: 0 });
  }
  for (const row of backup.data.exerciseGymProfiles) {
    requireParent(context, "exerciseGymProfiles", row, "exerciseId", "exercises");
    requireParent(context, "exerciseGymProfiles", row, "gymId", "gyms");
  }
  validateUnique(context, "exerciseGymProfiles", ["exerciseId", "gymId"], "duplicate exercise/gym profile ({key})");

  for (const row of backup.data.workouts) {
    if (row.status !== "active" && row.status !== "completed") addError(context, "workouts", row, `status has unsupported value ${String(row.status)}`);
    requireParent(context, "workouts", row, "gymId", "gyms", true);
    optionalFinite(context, "workouts", row, "bodyweight");
    optionalFinite(context, "workouts", row, "programCycleNumber", { integer: true, min: 1 });
    if (row.status === "active" && row.completedAt !== undefined) addError(context, "workouts", row, "an active workout cannot have completedAt");
    const programIds = [row.programId, row.programWeekId, row.programWorkoutId];
    if (programIds.some((value) => value !== undefined)) {
      if (programIds.some((value) => !Number.isInteger(value) || Number(value) < 1)) {
        addError(context, "workouts", row, "Program provenance requires positive programId, programWeekId, and programWorkoutId values");
      }
      for (const field of ["programNameSnapshot", "programWeekLabelSnapshot", "programWorkoutNameSnapshot"]) {
        if (typeof row[field] !== "string" || !row[field].trim()) addError(context, "workouts", row, `Program provenance requires ${field}`);
      }
    }
  }
  if (backup.data.workouts.filter((row) => row.status === "active").length > 1) {
    addError(context, "workouts", undefined, "at most one Workout may have active status");
  }

  for (const row of backup.data.workoutExercises) {
    requireParent(context, "workoutExercises", row, "workoutId", "workouts");
    requireParent(context, "workoutExercises", row, "exerciseId", "exercises");
    requireParent(context, "workoutExercises", row, "prescribedExerciseId", "exercises", true);
    validateOrder(context, "workoutExercises", row);
    validatePrescription(context, "workoutExercises", row);
    validateTechnique(context, "workoutExercises", row, "plannedLastSetIntensityTechnique");
    validateTechnique(context, "workoutExercises", row, "actualLastSetIntensityTechnique");
    if (row.prescribedExerciseId !== undefined && (typeof row.prescribedExerciseNameSnapshot !== "string" || !row.prescribedExerciseNameSnapshot.trim())) {
      addError(context, "workoutExercises", row, "prescribedExerciseId requires prescribedExerciseNameSnapshot");
    }
    if (row.sourceTemplateExerciseId !== undefined && row.prescribedExerciseId === undefined) {
      addError(context, "workoutExercises", row, "sourceTemplateExerciseId requires prescribed Exercise provenance");
    }
    if (row.qualityFlags !== undefined && (!Array.isArray(row.qualityFlags) || row.qualityFlags.some((flag) => !isWorkoutExerciseQualityFlag(flag)))) {
      addError(context, "workoutExercises", row, "qualityFlags contains an unsupported value");
    }
  }
  validateUnique(context, "workoutExercises", ["workoutId", "exerciseId"], "duplicate Exercise within Workout ({key})");
  validateUnique(context, "workoutExercises", ["workoutId", "order"], "duplicate exercise order within Workout ({key})");
  validateWorkoutSets(context);

  for (const row of backup.data.workoutTemplates) requireNonBlank(context, "workoutTemplates", row, "name");
  for (const row of backup.data.workoutTemplateExercises) {
    requireParent(context, "workoutTemplateExercises", row, "templateId", "workoutTemplates");
    requireParent(context, "workoutTemplateExercises", row, "exerciseId", "exercises");
    validateOrder(context, "workoutTemplateExercises", row);
    validatePrescription(context, "workoutTemplateExercises", row);
    validateTechnique(context, "workoutTemplateExercises", row, "plannedLastSetIntensityTechnique");
  }
  validateUnique(context, "workoutTemplateExercises", ["templateId", "exerciseId"], "duplicate Exercise within Template ({key})");
  validateUnique(context, "workoutTemplateExercises", ["templateId", "order"], "duplicate exercise order within Template ({key})");
  validateContiguous(context, "workoutTemplateExercises", "templateId");

  for (const row of backup.data.workoutTemplateExerciseSubstitutions) {
    requireParent(context, "workoutTemplateExerciseSubstitutions", row, "templateExerciseId", "workoutTemplateExercises");
    requireParent(context, "workoutTemplateExerciseSubstitutions", row, "substituteExerciseId", "exercises");
    validateOrder(context, "workoutTemplateExerciseSubstitutions", row);
    const source = rowsById.workoutTemplateExercises.get(Number(row.templateExerciseId));
    if (source?.exerciseId === row.substituteExerciseId) addError(context, "workoutTemplateExerciseSubstitutions", row, "a prescribed Exercise cannot substitute for itself");
  }
  validateUnique(context, "workoutTemplateExerciseSubstitutions", ["templateExerciseId", "substituteExerciseId"], "duplicate substitute Exercise for TemplateExercise ({key})");
  validateUnique(context, "workoutTemplateExerciseSubstitutions", ["templateExerciseId", "order"], "duplicate substitution order ({key})");
  validateContiguous(context, "workoutTemplateExerciseSubstitutions", "templateExerciseId");

  for (const row of backup.data.workoutExerciseSubstitutionOptions) {
    requireParent(context, "workoutExerciseSubstitutionOptions", row, "workoutExerciseId", "workoutExercises");
    requireParent(context, "workoutExerciseSubstitutionOptions", row, "exerciseId", "exercises");
    requireNonBlank(context, "workoutExerciseSubstitutionOptions", row, "exerciseNameSnapshot");
    validateOrder(context, "workoutExerciseSubstitutionOptions", row);
    const source = rowsById.workoutExercises.get(Number(row.workoutExerciseId));
    if (source && source.prescribedExerciseId === undefined) addError(context, "workoutExerciseSubstitutionOptions", row, "parent WorkoutExercise has no prescribed Exercise provenance");
    if (source?.prescribedExerciseId === row.exerciseId) addError(context, "workoutExerciseSubstitutionOptions", row, "the prescribed Exercise cannot also be a substitution option");
  }
  validateUnique(context, "workoutExerciseSubstitutionOptions", ["workoutExerciseId", "exerciseId"], "duplicate Exercise option for WorkoutExercise ({key})");
  validateUnique(context, "workoutExerciseSubstitutionOptions", ["workoutExerciseId", "order"], "duplicate workout substitution order ({key})");
  validateContiguous(context, "workoutExerciseSubstitutionOptions", "workoutExerciseId");

  for (const row of backup.data.programs) {
    requireNonBlank(context, "programs", row, "name");
    if (!["stop", "repeat", "continue_last_week"].includes(String(row.endBehavior))) addError(context, "programs", row, `endBehavior has unsupported value ${String(row.endBehavior)}`);
  }
  for (const row of backup.data.programWeeks) {
    requireParent(context, "programWeeks", row, "programId", "programs");
    validateOrder(context, "programWeeks", row);
  }
  validateUnique(context, "programWeeks", ["programId", "order"], "duplicate week order within Program ({key})");
  validateContiguous(context, "programWeeks", "programId");
  for (const row of backup.data.programWorkouts) {
    requireParent(context, "programWorkouts", row, "programWeekId", "programWeeks");
    requireParent(context, "programWorkouts", row, "templateId", "workoutTemplates");
    validateOrder(context, "programWorkouts", row);
  }
  validateUnique(context, "programWorkouts", ["programWeekId", "order"], "duplicate workout order within ProgramWeek ({key})");
  validateContiguous(context, "programWorkouts", "programWeekId");
  for (const row of backup.data.programWorkoutExerciseOverrides) {
    requireParent(context, "programWorkoutExerciseOverrides", row, "programWorkoutId", "programWorkouts");
    requireParent(context, "programWorkoutExerciseOverrides", row, "exerciseId", "exercises");
    validatePrescription(context, "programWorkoutExerciseOverrides", row);
    validateTechnique(context, "programWorkoutExerciseOverrides", row, "plannedLastSetIntensityTechnique", true);
    const slot = rowsById.programWorkouts.get(Number(row.programWorkoutId));
    const hasTemplateSlot = slot && backup.data.workoutTemplateExercises.some((templateExercise) =>
      templateExercise.templateId === slot.templateId && templateExercise.exerciseId === row.exerciseId);
    if (slot && !hasTemplateSlot) addError(context, "programWorkoutExerciseOverrides", row, "exerciseId is not present in the ProgramWorkout's Template");
  }
  validateUnique(context, "programWorkoutExerciseOverrides", ["programWorkoutId", "exerciseId"], "duplicate override for ProgramWorkout and Exercise ({key})");

  if (backup.data.activeProgramStates.length > 1) addError(context, "activeProgramStates", undefined, "only one active Program state is allowed");
  for (const row of backup.data.activeProgramStates) {
    requireParent(context, "activeProgramStates", row, "programId", "programs");
    requireParent(context, "activeProgramStates", row, "currentProgramWeekId", "programWeeks");
    requireParent(context, "activeProgramStates", row, "currentProgramWorkoutId", "programWorkouts");
    optionalFinite(context, "activeProgramStates", row, "cycleNumber", { integer: true, min: 1 });
    const week = rowsById.programWeeks.get(Number(row.currentProgramWeekId));
    const workout = rowsById.programWorkouts.get(Number(row.currentProgramWorkoutId));
    if (week && week.programId !== row.programId) addError(context, "activeProgramStates", row, "currentProgramWeekId does not belong to programId");
    if (workout && workout.programWeekId !== row.currentProgramWeekId) addError(context, "activeProgramStates", row, "currentProgramWorkoutId does not belong to currentProgramWeekId");
  }

  validateMyoSets(context);
  validateWorkoutExerciseTechniques(context);
  return context.errors.length ? { valid: false, errors: context.errors } : { valid: true, errors: [] };
}

export function formatBackupValidationErrors(errors: BackupValidationError[], visibleLimit = 15) {
  const visible = errors.slice(0, visibleLimit).map((error) => {
    const row = error.rowId === undefined ? "" : ` ${String(error.rowId)}`;
    const prefix = error.collection === "backup" ? "Backup" : `${label(error.collection)}${row}`;
    return `${prefix}: ${error.message}`;
  });
  const remainder = errors.length - visible.length;
  return [`Backup validation failed with ${errors.length} error${errors.length === 1 ? "" : "s"}:`, ...visible,
    ...(remainder > 0 ? [`…and ${remainder} more error${remainder === 1 ? "" : "s"}.`] : [])].join("\n");
}
