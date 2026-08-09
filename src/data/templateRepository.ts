import { db } from "../db/db";
import type {
  WorkoutTemplate,
  WorkoutTemplateExercise,
  WorkoutTemplateExerciseSubstitution
} from "../db/types";

function nowString() {
  return new Date().toISOString();
}

export type TemplateWithExercises = {
  template: WorkoutTemplate;
  exercises: WorkoutTemplateExercise[];
  substitutions: WorkoutTemplateExerciseSubstitution[];
};

export async function createWorkoutTemplate(
  name: string
): Promise<number> {
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("Template name is required.");
  }

  const existingTemplate = await db.workoutTemplates
    .where("name")
    .equalsIgnoreCase(trimmedName)
    .first();

  if (existingTemplate) {
    throw new Error("A template with that name already exists.");
  }

  const now = nowString();

  return await db.workoutTemplates.add({
    name: trimmedName,
    createdAt: now,
    updatedAt: now
  });
}

export async function getWorkoutTemplates(): Promise<
  WorkoutTemplate[]
> {
  return await db.workoutTemplates
    .orderBy("name")
    .toArray();
}

export async function getTemplateWithExercises(
  templateId: number
): Promise<TemplateWithExercises | null> {
  const template = await db.workoutTemplates.get(templateId);

  if (!template) return null;

  const exercises = await db.workoutTemplateExercises
    .where("templateId")
    .equals(templateId)
    .sortBy("order");
  const exerciseIds = exercises.flatMap((row) => row.id ?? []);
  const substitutions = exerciseIds.length
    ? await db.workoutTemplateExerciseSubstitutions.where("templateExerciseId").anyOf(exerciseIds).sortBy("order")
    : [];

  return {
    template,
    exercises,
    substitutions
  };
}

export async function updateWorkoutTemplate(
  templateId: number,
  changes: {
    name?: string;
    notes?: string;
  }
): Promise<void> {
  await db.workoutTemplates.update(templateId, {
    name: changes.name?.trim(),
    notes: changes.notes?.trim() || undefined,
    updatedAt: nowString()
  });
}

export async function deleteWorkoutTemplate(
  templateId: number
): Promise<void> {
  const usageCount = await db.programWorkouts.where("templateId").equals(templateId).count();
  if (usageCount) throw new Error(`This template is used by ${usageCount} program workout slot${usageCount === 1 ? "" : "s"}. Remove those slots before deleting it.`);
  await db.transaction(
    "rw",
    db.workoutTemplates,
    db.workoutTemplateExercises,
    db.workoutTemplateExerciseSubstitutions,
    async () => {
      const templateExerciseIds = (await db.workoutTemplateExercises.where("templateId").equals(templateId).primaryKeys()) as number[];
      if (templateExerciseIds.length) {
        await db.workoutTemplateExerciseSubstitutions.where("templateExerciseId").anyOf(templateExerciseIds).delete();
      }
      await db.workoutTemplateExercises
        .where("templateId")
        .equals(templateId)
        .delete();

      await db.workoutTemplates.delete(templateId);
    }
  );
}

export async function addExerciseToTemplate(
  templateId: number,
  exerciseId: number
): Promise<number> {
  const existingRows = await db.workoutTemplateExercises
    .where("templateId")
    .equals(templateId)
    .toArray();

  const duplicate = existingRows.some(
    (row) => row.exerciseId === exerciseId
  );

  if (duplicate) {
    throw new Error(
      "That exercise is already in this template."
    );
  }

  const now = nowString();

  const templateExerciseId =
    await db.workoutTemplateExercises.add({
      templateId,
      exerciseId,
      order: existingRows.length + 1,
      plannedSetCount: 3,
      createdAt: now,
      updatedAt: now
    });

  await db.workoutTemplates.update(templateId, {
    updatedAt: now
  });

  return templateExerciseId;
}

export async function updateTemplateExercise(
  templateExerciseId: number,
  changes: Partial<
    Pick<
      WorkoutTemplateExercise,
      | "plannedSetCount"
      | "targetMinReps"
      | "targetMaxReps"
      | "targetRpeMin"
      | "targetRpeMax"
      | "targetRestSeconds"
      | "warmupInstructions"
      | "prescriptionNotes"
      | "plannedLastSetIntensityTechnique"
    >
  >
): Promise<void> {
  const templateExercise =
    await db.workoutTemplateExercises.get(
      templateExerciseId
    );

  if (!templateExercise) {
    throw new Error(
      "Template exercise could not be found."
    );
  }

  const now = nowString();

  await db.transaction(
    "rw",
    db.workoutTemplateExercises,
    db.workoutTemplates,
    async () => {
      await db.workoutTemplateExercises.update(
        templateExerciseId,
        {
          ...changes,
          updatedAt: now
        }
      );

      await db.workoutTemplates.update(
        templateExercise.templateId,
        {
          updatedAt: now
        }
      );
    }
  );
}

export async function removeExerciseFromTemplate(
  templateExerciseId: number
): Promise<void> {
  const removedExercise =
    await db.workoutTemplateExercises.get(
      templateExerciseId
    );

  if (!removedExercise) return;

  await db.transaction(
    "rw",
    db.workoutTemplateExercises,
    db.workoutTemplateExerciseSubstitutions,
    db.workoutTemplates,
    db.programWorkouts,
    db.programWorkoutExerciseOverrides,
    async () => {
      await db.workoutTemplateExerciseSubstitutions.where("templateExerciseId").equals(templateExerciseId).delete();
      const programWorkoutIds = (await db.programWorkouts.where("templateId").equals(removedExercise.templateId).primaryKeys()) as number[];
      if (programWorkoutIds.length) {
        await db.programWorkoutExerciseOverrides.where("programWorkoutId").anyOf(programWorkoutIds)
          .and((row) => row.exerciseId === removedExercise.exerciseId).delete();
      }
      await db.workoutTemplateExercises.delete(templateExerciseId);
      const remainingExercises = await db.workoutTemplateExercises
        .where("templateId").equals(removedExercise.templateId).sortBy("order");
      for (
        let index = 0;
        index < remainingExercises.length;
        index++
      ) {
        const row = remainingExercises[index];

        if (!row.id) continue;

        await db.workoutTemplateExercises.update(
          row.id,
          {
            order: index + 1,
            updatedAt: nowString()
          }
        );
      }

      await db.workoutTemplates.update(
        removedExercise.templateId,
        {
          updatedAt: nowString()
        }
      );
    }
  );
}

export async function addTemplateExerciseSubstitution(
  templateExerciseId: number,
  substituteExerciseId: number
): Promise<number> {
  const source = await db.workoutTemplateExercises.get(templateExerciseId);
  if (!source) throw new Error("Template exercise could not be found.");
  if (source.exerciseId === substituteExerciseId) {
    throw new Error("The prescribed exercise cannot substitute for itself.");
  }
  if (!await db.exercises.get(substituteExerciseId)) throw new Error("Substitute exercise could not be found.");
  const existing = await db.workoutTemplateExerciseSubstitutions
    .where("templateExerciseId").equals(templateExerciseId).sortBy("order");
  if (existing.some((row) => row.substituteExerciseId === substituteExerciseId)) {
    throw new Error("That substitute is already allowed for this exercise.");
  }
  const now = nowString();
  return db.transaction("rw", db.workoutTemplateExerciseSubstitutions, db.workoutTemplates, async () => {
    const id = await db.workoutTemplateExerciseSubstitutions.add({
      templateExerciseId,
      substituteExerciseId,
      order: existing.length + 1,
      createdAt: now,
      updatedAt: now
    });
    await db.workoutTemplates.update(source.templateId, { updatedAt: now });
    return id;
  });
}

export async function removeTemplateExerciseSubstitution(id: number): Promise<void> {
  const removed = await db.workoutTemplateExerciseSubstitutions.get(id);
  if (!removed) return;
  const source = await db.workoutTemplateExercises.get(removed.templateExerciseId);
  await db.transaction("rw", db.workoutTemplateExerciseSubstitutions, db.workoutTemplates, async () => {
    await db.workoutTemplateExerciseSubstitutions.delete(id);
    const remaining = await db.workoutTemplateExerciseSubstitutions
      .where("templateExerciseId").equals(removed.templateExerciseId).sortBy("order");
    const now = nowString();
    for (const [index, row] of remaining.entries()) {
      if (row.id) await db.workoutTemplateExerciseSubstitutions.update(row.id, { order: index + 1, updatedAt: now });
    }
    if (source) await db.workoutTemplates.update(source.templateId, { updatedAt: now });
  });
}

export async function moveTemplateExerciseSubstitution(id: number, direction: "up" | "down"): Promise<void> {
  const current = await db.workoutTemplateExerciseSubstitutions.get(id);
  if (!current) return;
  const rows = await db.workoutTemplateExerciseSubstitutions
    .where("templateExerciseId").equals(current.templateExerciseId).sortBy("order");
  const index = rows.findIndex((row) => row.id === id);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= rows.length) return;
  const target = rows[targetIndex];
  const source = await db.workoutTemplateExercises.get(current.templateExerciseId);
  const now = nowString();
  await db.transaction("rw", db.workoutTemplateExerciseSubstitutions, db.workoutTemplates, async () => {
    await db.workoutTemplateExerciseSubstitutions.update(id, { order: target.order, updatedAt: now });
    await db.workoutTemplateExerciseSubstitutions.update(target.id!, { order: current.order, updatedAt: now });
    if (source) await db.workoutTemplates.update(source.templateId, { updatedAt: now });
  });
}

export async function moveTemplateExercise(
  templateExerciseId: number,
  direction: "up" | "down"
): Promise<void> {
  const current =
    await db.workoutTemplateExercises.get(
      templateExerciseId
    );

  if (!current) return;

  const orderedExercises =
    await db.workoutTemplateExercises
      .where("templateId")
      .equals(current.templateId)
      .sortBy("order");

  const currentIndex = orderedExercises.findIndex(
    (row) => row.id === templateExerciseId
  );

  const targetIndex =
    direction === "up"
      ? currentIndex - 1
      : currentIndex + 1;

  if (
    currentIndex < 0 ||
    targetIndex < 0 ||
    targetIndex >= orderedExercises.length
  ) {
    return;
  }

  const target = orderedExercises[targetIndex];

  if (!target.id || !current.id) return;

  const now = nowString();

  await db.transaction(
    "rw",
    db.workoutTemplateExercises,
    db.workoutTemplates,
    async () => {
      await db.workoutTemplateExercises.update(
        current.id!,
        {
          order: target.order,
          updatedAt: now
        }
      );

      await db.workoutTemplateExercises.update(
        target.id!,
        {
          order: current.order,
          updatedAt: now
        }
      );

      await db.workoutTemplates.update(
        current.templateId,
        {
          updatedAt: now
        }
      );
    }
  );
}
