import { db } from "../db/db";
import type {
  WorkoutTemplate,
  WorkoutTemplateExercise
} from "../db/types";

function nowString() {
  return new Date().toISOString();
}

export type TemplateWithExercises = {
  template: WorkoutTemplate;
  exercises: WorkoutTemplateExercise[];
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

  return {
    template,
    exercises
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
    async () => {
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

  await db.workoutTemplateExercises.delete(
    templateExerciseId
  );

  const remainingExercises =
    await db.workoutTemplateExercises
      .where("templateId")
      .equals(removedExercise.templateId)
      .sortBy("order");

  await db.transaction(
    "rw",
    db.workoutTemplateExercises,
    db.workoutTemplates,
    async () => {
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
