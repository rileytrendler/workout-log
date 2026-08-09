import {
  BACKUP_COLLECTIONS,
  CURRENT_BACKUP_VERSION,
  normalizeBackup,
  validateBackup,
  type BackupCollectionName,
  type BackupRow
} from "./backupValidation";

type FixtureBackup = {
  appName: "workout-log";
  backupVersion: number;
  exportedAt: string;
  data: Record<BackupCollectionName, BackupRow[]>;
};

function baseBackup(): FixtureBackup {
  const at = "2026-08-08T12:00:00.000Z";
  return {
    appName: "workout-log",
    backupVersion: CURRENT_BACKUP_VERSION,
    exportedAt: at,
    data: {
      gyms: [{ id: 1, name: "Home", createdAt: at }],
      exercises: [
        { id: 1, name: "Press", defaultUnit: "lb", measurementType: "weight_reps", createdAt: at },
        { id: 2, name: "Dumbbell Press", defaultUnit: "lb", measurementType: "weight_reps", createdAt: at }
      ],
      exerciseGymProfiles: [{ id: 1, exerciseId: 1, gymId: 1, createdAt: at, updatedAt: at }],
      workouts: [{
        id: 1, date: "2026-08-08", status: "completed", completedAt: at, gymId: 1,
        programId: 1, programWeekId: 1, programWorkoutId: 1, programCycleNumber: 1,
        programNameSnapshot: "Strength", programWeekLabelSnapshot: "Week 1",
        programWorkoutNameSnapshot: "Press Day", createdAt: at, updatedAt: at
      }],
      workoutExercises: [{
        id: 1, workoutId: 1, exerciseId: 1, order: 1, sourceTemplateExerciseId: 1,
        prescribedExerciseId: 1, prescribedExerciseNameSnapshot: "Press",
        plannedSetCount: 1, targetMinReps: 8, targetMaxReps: 12,
        plannedLastSetIntensityTechnique: "myo_reps", actualLastSetIntensityTechnique: "myo_reps",
        qualityFlags: ["low_energy"], createdAt: at, updatedAt: at
      }],
      workoutSets: [{
        id: 1, workoutExerciseId: 1, setNumber: 1, weight: 100, reps: 9,
        failedOnRep: 10, actualRpe: 10, isFailure: true, performedAt: at, createdAt: at, updatedAt: at
      }],
      workoutSetMyoSets: [{ id: 1, workoutSetId: 1, order: 1, reps: 4, createdAt: at, updatedAt: at }],
      workoutTemplates: [{ id: 1, name: "Press Day", createdAt: at, updatedAt: at }],
      workoutTemplateExercises: [{
        id: 1, templateId: 1, exerciseId: 1, order: 1, plannedSetCount: 1,
        plannedLastSetIntensityTechnique: "myo_reps", createdAt: at, updatedAt: at
      }],
      workoutTemplateExerciseSubstitutions: [{
        id: 1, templateExerciseId: 1, substituteExerciseId: 2, order: 1, createdAt: at, updatedAt: at
      }],
      workoutExerciseSubstitutionOptions: [{
        id: 1, workoutExerciseId: 1, exerciseId: 2, order: 1,
        exerciseNameSnapshot: "Dumbbell Press", createdAt: at
      }],
      programs: [{ id: 1, name: "Strength", endBehavior: "repeat", createdAt: at, updatedAt: at }],
      programWeeks: [{ id: 1, programId: 1, order: 1, createdAt: at, updatedAt: at }],
      programWorkouts: [{ id: 1, programWeekId: 1, templateId: 1, order: 1, createdAt: at, updatedAt: at }],
      programWorkoutExerciseOverrides: [{
        id: 1, programWorkoutId: 1, exerciseId: 1, targetRpeMax: 9,
        plannedLastSetIntensityTechnique: null, createdAt: at, updatedAt: at
      }],
      activeProgramStates: [{
        id: 1, programId: 1, currentProgramWeekId: 1, currentProgramWorkoutId: 1,
        cycleNumber: 2, activatedAt: at, updatedAt: at
      }]
    }
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function errors(value: unknown) {
  const result = validateBackup(normalizeBackup(value));
  return result.valid ? [] : result.errors.map((error) => error.message);
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`Fixture failed: ${message}`);
}

function assertRejected(value: unknown, fragment: string) {
  const messages = errors(value);
  assert(messages.some((message) => message.includes(fragment)), `expected rejection containing “${fragment}”; got ${messages.join(" | ")}`);
}

export function runBackupValidationFixtures() {
  const current = baseBackup();
  assert(errors(current).length === 0, "current v2 backup should validate");
  assert(errors(JSON.parse(JSON.stringify(current))).length === 0, "JSON round-trip should remain valid");

  const legacy = clone(current) as unknown as Record<string, unknown>;
  legacy.backupVersion = 1;
  const legacyData = legacy.data as Record<string, BackupRow[]>;
  for (const collection of [
    "exerciseGymProfiles", "workoutSetMyoSets", "workoutTemplateExerciseSubstitutions",
    "workoutExerciseSubstitutionOptions", "programs", "programWeeks", "programWorkouts",
    "programWorkoutExerciseOverrides", "activeProgramStates"
  ]) delete legacyData[collection];
  delete legacyData.workouts[0].status;
  delete legacyData.exercises[0].measurementType;
  delete legacyData.exercises[0].loadEntryMode;
  legacyData.workoutSets[0].reps = 10;
  assert(errors(legacy).length === 0, "version 1 omissions and old failure shape should normalize");
  const normalizedLegacy = normalizeBackup(legacy);
  assert(normalizedLegacy.data.exercises[0].loadEntryMode === "standard", "legacy Exercise mode should normalize to standard");

  const mismatchedExpression = clone(current);
  mismatchedExpression.data.exercises[0].loadEntryMode = "expression";
  mismatchedExpression.data.workoutSets[0].loadExpression = "7x45+25";
  mismatchedExpression.data.workoutSets[0].weight = 300;
  assertRejected(mismatchedExpression, "does not match weight 300");

  const duplicateId = clone(current);
  duplicateId.data.workoutSets.push({ ...duplicateId.data.workoutSets[0] });
  assertRejected(duplicateId, "duplicate primary id 1");

  const orphanSet = clone(current);
  orphanSet.data.workoutSets[0].workoutExerciseId = 999;
  assertRejected(orphanSet, "references missing WorkoutExercise 999");

  const invalidFailure = clone(current);
  invalidFailure.data.workoutSets[0].reps = 10;
  assertRejected(invalidFailure, "failedOnRep must equal completed reps plus one");

  const orphanMyo = clone(current);
  orphanMyo.data.workoutSetMyoSets[0].workoutSetId = 999;
  assertRejected(orphanMyo, "references missing WorkoutSet 999");

  const duplicateSubstitution = clone(current);
  duplicateSubstitution.data.workoutTemplateExerciseSubstitutions.push({
    ...duplicateSubstitution.data.workoutTemplateExerciseSubstitutions[0], id: 2, order: 2
  });
  assertRejected(duplicateSubstitution, "duplicate substitute Exercise for TemplateExercise");

  const activeWorkouts = clone(current);
  activeWorkouts.data.workouts[0].status = "active";
  delete activeWorkouts.data.workouts[0].completedAt;
  activeWorkouts.data.workouts.push({ ...activeWorkouts.data.workouts[0], id: 2 });
  assertRejected(activeWorkouts, "at most one Workout may have active status");

  const activePrograms = clone(current);
  activePrograms.data.activeProgramStates.push({ ...activePrograms.data.activeProgramStates[0], id: 2 });
  assertRejected(activePrograms, "only one active Program state is allowed");

  const badActiveReference = clone(current);
  badActiveReference.data.activeProgramStates[0].currentProgramWorkoutId = 999;
  assertRejected(badActiveReference, "references missing ProgramWorkout 999");

  const badQualityFlag = clone(current);
  badQualityFlag.data.workoutExercises[0].qualityFlags = ["unknown_flag"];
  assertRejected(badQualityFlag, "qualityFlags contains an unsupported value");

  const incompleteV2 = clone(current);
  delete (incompleteV2.data as Partial<typeof incompleteV2.data>).workoutSetMyoSets;
  assertRejected(incompleteV2, "missing required workoutSetMyoSets collection");

  assert(BACKUP_COLLECTIONS.every((collection) => Object.hasOwn(current.data, collection)), "fixture/export shape includes every persisted collection");
  console.info("Backup validation fixtures passed.");
}

runBackupValidationFixtures();
