import { db } from "../db/db";

export type WorkoutLogBackup = {
  exportedAt: string;
  appName: "workout-log";
  backupVersion: 1;
  data: {
    gyms: unknown[];
    exercises: unknown[];
    workouts: unknown[];
    workoutExercises: unknown[];
    workoutSets: unknown[];
    workoutTemplates: unknown[];
    workoutTemplateExercises: unknown[];
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
      workouts: await db.workouts.toArray(),
      workoutExercises: await db.workoutExercises.toArray(),
      workoutSets: await db.workoutSets.toArray(),
      workoutTemplates: await db.workoutTemplates.toArray(),
      workoutTemplateExercises:
        await db.workoutTemplateExercises.toArray()
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

  const confirmed = confirm("Importing this backup will replace all current local workout data. Continue?");

  if (!confirmed) return;

  await db.transaction(
    "rw",
    [
      db.gyms,
      db.exercises,
      db.workouts,
      db.workoutExercises,
      db.workoutSets,
      db.workoutTemplates,
      db.workoutTemplateExercises
    ],
    async () => {
      await db.workoutTemplateExercises.clear();
      await db.workoutTemplates.clear();
      await db.workoutSets.clear();
      await db.workoutExercises.clear();
      await db.workouts.clear();
      await db.exercises.clear();
      await db.gyms.clear();

      await db.gyms.bulkAdd(parsed.data.gyms as never[]);
      await db.exercises.bulkAdd(parsed.data.exercises as never[]);

      await db.workoutTemplates.bulkAdd(
        (parsed.data.workoutTemplates ?? []) as never[]
      );

      await db.workoutTemplateExercises.bulkAdd(
        (parsed.data.workoutTemplateExercises ?? []) as never[]
      );

      await db.workouts.bulkAdd(parsed.data.workouts as never[]);

      await db.workoutExercises.bulkAdd(
        parsed.data.workoutExercises as never[]
      );

      await db.workoutSets.bulkAdd(
        parsed.data.workoutSets as never[]
      );
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
  const workouts = await db.workouts.toArray();
  const workoutExercises = await db.workoutExercises.toArray();
  const workoutSets = await db.workoutSets.toArray();
  const exercises = await db.exercises.toArray();

  const workoutById = new Map(workouts.map((workout) => [workout.id, workout]));
  const workoutExerciseById = new Map(workoutExercises.map((workoutExercise) => [workoutExercise.id, workoutExercise]));
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));

  const rows: unknown[][] = [
    [
      "workoutDate",
      "workoutTitle",
      "workoutNotes",
      "workoutStartTime",
      "workoutLastSetAt",
      "exerciseName",
      "exerciseNotes",
      "setNumber",
      "weight",
      "reps",
      "actualRpe",
      "rir",
      "isWarmup",
      "isFailure",
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

    rows.push([
      workout?.date,
      workout?.title,
      workout?.notes,
      workout?.startTime,
      workout?.lastSetAt,
      exercise?.name,
      workoutExercise?.notes,
      set.setNumber,
      set.weight,
      set.reps,
      set.actualRpe,
      set.rir,
      set.isWarmup,
      set.isFailure,
      set.notes,
      set.performedAt ?? set.createdAt,
      set.createdAt,
      set.updatedAt
    ]);
  }

  const date = new Date().toISOString().slice(0, 10);
  downloadCsv(`workout-log-sets-${date}.csv`, rows);
}
