import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ExerciseAutocomplete } from "./ExerciseAutocomplete";
import { getOrCreateExercise } from "../data/exerciseRepository";
import {
  addExerciseToTemplate,
  createWorkoutTemplate,
  deleteWorkoutTemplate,
  getTemplateWithExercises,
  getWorkoutTemplates,
  moveTemplateExercise,
  removeExerciseFromTemplate,
  updateTemplateExercise,
  updateWorkoutTemplate
} from "../data/templateRepository";
import type {
  Exercise,
  WorkoutTemplateExercise
} from "../db/types";

type TemplateEditorProps = {
  exercises: Exercise[];
};

type TemplateExerciseFields = {
  plannedSetCount: string;
  targetMinReps: string;
  targetMaxReps: string;
  targetRpeMin: string;
  targetRpeMax: string;
  targetRestSeconds: string;
  warmupInstructions: string;
  prescriptionNotes: string;
};

function optionalNumber(value: string) {
  if (!value.trim()) return undefined;

  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    throw new Error("Numeric fields must contain valid numbers.");
  }

  return parsed;
}

function TemplateExerciseEditor({
  templateExercise,
  exerciseName,
  isFirst,
  isLast
}: {
  templateExercise: WorkoutTemplateExercise;
  exerciseName: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [fields, setFields] = useState<TemplateExerciseFields>({
    plannedSetCount: "",
    targetMinReps: "",
    targetMaxReps: "",
    targetRpeMin: "",
    targetRpeMax: "",
    targetRestSeconds: "",
    warmupInstructions: "",
    prescriptionNotes: ""
  });

  useEffect(() => {
    setFields({
      plannedSetCount:
        templateExercise.plannedSetCount?.toString() ?? "",
      targetMinReps:
        templateExercise.targetMinReps?.toString() ?? "",
      targetMaxReps:
        templateExercise.targetMaxReps?.toString() ?? "",
      targetRpeMin:
        templateExercise.targetRpeMin?.toString() ?? "",
      targetRpeMax:
        templateExercise.targetRpeMax?.toString() ?? "",
      targetRestSeconds:
        templateExercise.targetRestSeconds?.toString() ?? "",
      warmupInstructions:
        templateExercise.warmupInstructions ?? "",
      prescriptionNotes:
        templateExercise.prescriptionNotes ?? ""
    });
  }, [templateExercise]);

  function updateField(
    field: keyof TemplateExerciseFields,
    value: string
  ) {
    setFields((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function saveTargets() {
    if (!templateExercise.id) return;

    try {
      const plannedSetCount = optionalNumber(
        fields.plannedSetCount
      );
      const targetMinReps = optionalNumber(
        fields.targetMinReps
      );
      const targetMaxReps = optionalNumber(
        fields.targetMaxReps
      );
      const targetRpeMin = optionalNumber(
        fields.targetRpeMin
      );
      const targetRpeMax = optionalNumber(
        fields.targetRpeMax
      );
      const targetRestSeconds = optionalNumber(
        fields.targetRestSeconds
      );

      if (
        plannedSetCount !== undefined &&
        (!Number.isInteger(plannedSetCount) ||
          plannedSetCount < 1)
      ) {
        throw new Error(
          "Planned set count must be a positive whole number."
        );
      }

      if (
        targetMinReps !== undefined &&
        (!Number.isInteger(targetMinReps) ||
          targetMinReps < 0)
      ) {
        throw new Error(
          "Minimum reps must be a nonnegative whole number."
        );
      }

      if (
        targetMaxReps !== undefined &&
        (!Number.isInteger(targetMaxReps) ||
          targetMaxReps < 0)
      ) {
        throw new Error(
          "Maximum reps must be a nonnegative whole number."
        );
      }

      if (
        targetMinReps !== undefined &&
        targetMaxReps !== undefined &&
        targetMinReps > targetMaxReps
      ) {
        throw new Error(
          "Minimum reps cannot be greater than maximum reps."
        );
      }

      if (
        targetRpeMin !== undefined &&
        (targetRpeMin < 0 || targetRpeMin > 10)
      ) {
        throw new Error(
          "Minimum RPE must be between 0 and 10."
        );
      }

      if (
        targetRpeMax !== undefined &&
        (targetRpeMax < 0 || targetRpeMax > 10)
      ) {
        throw new Error(
          "Maximum RPE must be between 0 and 10."
        );
      }

      if (
        targetRpeMin !== undefined &&
        targetRpeMax !== undefined &&
        targetRpeMin > targetRpeMax
      ) {
        throw new Error(
          "Minimum RPE cannot be greater than maximum RPE."
        );
      }

      if (
        targetRestSeconds !== undefined &&
        targetRestSeconds < 0
      ) {
        throw new Error(
          "Target rest time cannot be negative."
        );
      }

      await updateTemplateExercise(
        templateExercise.id,
        {
          plannedSetCount,
          targetMinReps,
          targetMaxReps,
          targetRpeMin,
          targetRpeMax,
          targetRestSeconds,
          warmupInstructions:
            fields.warmupInstructions.trim() || undefined,
          prescriptionNotes:
            fields.prescriptionNotes.trim() || undefined
        }
      );
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Template exercise could not be updated."
      );
    }
  }

  async function removeExercise() {
    if (!templateExercise.id) return;

    const confirmed = confirm(
      `Remove ${exerciseName} from this template?`
    );

    if (!confirmed) return;

    await removeExerciseFromTemplate(
      templateExercise.id
    );
  }

  return (
    <div className="template-exercise-card">
      <div className="template-exercise-header">
        <div>
          <span className="template-order-number">
            {templateExercise.order}.
          </span>

          <strong>{exerciseName}</strong>
        </div>

        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            disabled={isFirst}
            onClick={() =>
              templateExercise.id &&
              moveTemplateExercise(
                templateExercise.id,
                "up"
              )
            }
          >
            Move Up
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={isLast}
            onClick={() =>
              templateExercise.id &&
              moveTemplateExercise(
                templateExercise.id,
                "down"
              )
            }
          >
            Move Down
          </button>

          <button
            type="button"
            className="secondary-button danger"
            onClick={removeExercise}
          >
            Remove
          </button>
        </div>
      </div>

      <div className="template-target-grid">
        <label className="field-label">
          Working Sets
          <input
            inputMode="numeric"
            value={fields.plannedSetCount}
            onChange={(event) =>
              updateField(
                "plannedSetCount",
                event.target.value
              )
            }
            placeholder="3"
          />
        </label>

        <label className="field-label">
          Minimum Reps
          <input
            inputMode="numeric"
            value={fields.targetMinReps}
            onChange={(event) =>
              updateField(
                "targetMinReps",
                event.target.value
              )
            }
            placeholder="8"
          />
        </label>

        <label className="field-label">
          Maximum Reps
          <input
            inputMode="numeric"
            value={fields.targetMaxReps}
            onChange={(event) =>
              updateField(
                "targetMaxReps",
                event.target.value
              )
            }
            placeholder="12"
          />
        </label>

        <label className="field-label">
          Minimum RPE
          <input
            inputMode="decimal"
            value={fields.targetRpeMin}
            onChange={(event) =>
              updateField(
                "targetRpeMin",
                event.target.value
              )
            }
            placeholder="7"
          />
        </label>

        <label className="field-label">
          Maximum RPE
          <input
            inputMode="decimal"
            value={fields.targetRpeMax}
            onChange={(event) =>
              updateField(
                "targetRpeMax",
                event.target.value
              )
            }
            placeholder="9"
          />
        </label>

        <label className="field-label">
          Rest Seconds
          <input
            inputMode="numeric"
            value={fields.targetRestSeconds}
            onChange={(event) =>
              updateField(
                "targetRestSeconds",
                event.target.value
              )
            }
            placeholder="120"
          />
        </label>
      </div>

      <label className="field-label">
        Warmup Instructions
        <textarea
          value={fields.warmupInstructions}
          onChange={(event) =>
            updateField(
              "warmupInstructions",
              event.target.value
            )
          }
          placeholder="Example: Bar × 15, 50% × 8, 70% × 3"
        />
      </label>

      <label className="field-label">
        Prescription Notes
        <textarea
          value={fields.prescriptionNotes}
          onChange={(event) =>
            updateField(
              "prescriptionNotes",
              event.target.value
            )
          }
          placeholder="Program-specific instructions for this exercise..."
        />
      </label>

      <button
        type="button"
        onClick={saveTargets}
      >
        Save Exercise Targets
      </button>
    </div>
  );
}

export function TemplateEditor({
  exercises
}: TemplateEditorProps) {
  const [newTemplateName, setNewTemplateName] =
    useState("");
  const [
    selectedTemplateId,
    setSelectedTemplateId
  ] = useState<number | null>(null);
  const [templateName, setTemplateName] =
    useState("");
  const [templateNotes, setTemplateNotes] =
    useState("");
  const [exerciseName, setExerciseName] =
    useState("");

  const templates = useLiveQuery(
    () => getWorkoutTemplates(),
    []
  );

  const selectedTemplate = useLiveQuery(
    () =>
      selectedTemplateId
        ? getTemplateWithExercises(
            selectedTemplateId
          )
        : Promise.resolve(null),
    [selectedTemplateId]
  );

  useEffect(() => {
    if (
      selectedTemplateId === null &&
      templates?.length &&
      templates[0].id
    ) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates, selectedTemplateId]);

  useEffect(() => {
    if (!selectedTemplate) return;

    setTemplateName(
      selectedTemplate.template.name
    );
    setTemplateNotes(
      selectedTemplate.template.notes ?? ""
    );
  }, [selectedTemplate]);

  async function createTemplate(
    event: React.FormEvent
  ) {
    event.preventDefault();

    try {
      const templateId =
        await createWorkoutTemplate(
          newTemplateName
        );

      setNewTemplateName("");
      setSelectedTemplateId(templateId);
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Template could not be created."
      );
    }
  }

  async function saveTemplateDetails() {
    if (!selectedTemplateId) return;

    if (!templateName.trim()) {
      alert("Template name is required.");
      return;
    }

    try {
      await updateWorkoutTemplate(
        selectedTemplateId,
        {
          name: templateName,
          notes: templateNotes
        }
      );
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Template could not be updated."
      );
    }
  }

  async function deleteSelectedTemplate() {
    if (!selectedTemplateId) return;

    const confirmed = confirm(
      `Delete template "${selectedTemplate?.template.name ?? "Untitled"}"?`
    );

    if (!confirmed) return;

    await deleteWorkoutTemplate(
      selectedTemplateId
    );

    setSelectedTemplateId(null);
    setTemplateName("");
    setTemplateNotes("");
  }

  async function addExercise(
    event: React.FormEvent
  ) {
    event.preventDefault();

    if (!selectedTemplateId) return;

    try {
      const exerciseId =
        await getOrCreateExercise(
          exerciseName
        );

      await addExerciseToTemplate(
        selectedTemplateId,
        exerciseId
      );

      setExerciseName("");
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Exercise could not be added."
      );
    }
  }

  function getExerciseName(
    exerciseId: number
  ) {
    return (
      exercises.find(
        (exercise) =>
          exercise.id === exerciseId
      )?.name ?? "Unknown Exercise"
    );
  }

  return (
    <section>
      <h2>Workout Templates</h2>

      <div className="card">
        <h3>Create Template</h3>

        <form
          className="inline-form"
          onSubmit={createTemplate}
        >
          <input
            value={newTemplateName}
            onChange={(event) =>
              setNewTemplateName(
                event.target.value
              )
            }
            placeholder="Push 1, Pull 1, Upper, etc."
          />

          <button type="submit">
            Create Template
          </button>
        </form>
      </div>

      {templates?.length ? (
        <div className="template-layout">
          <div className="template-list">
            {templates.map((template) => (
              <button
                type="button"
                key={template.id}
                className={`template-list-item ${
                  selectedTemplateId ===
                  template.id
                    ? "selected-template-item"
                    : ""
                }`}
                onClick={() =>
                  setSelectedTemplateId(
                    template.id ?? null
                  )
                }
              >
                {template.name}
              </button>
            ))}
          </div>

          <div className="template-editor-panel">
            {selectedTemplate ? (
              <>
                <div className="card">
                  <div className="template-editor-heading">
                    <h3>Template Details</h3>

                    <button
                      type="button"
                      className="secondary-button danger"
                      onClick={
                        deleteSelectedTemplate
                      }
                    >
                      Delete Template
                    </button>
                  </div>

                  <label className="field-label">
                    Template Name
                    <input
                      value={templateName}
                      onChange={(event) =>
                        setTemplateName(
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label className="field-label">
                    Template Notes
                    <textarea
                      value={templateNotes}
                      onChange={(event) =>
                        setTemplateNotes(
                          event.target.value
                        )
                      }
                      placeholder="General notes about this workout..."
                    />
                  </label>

                  <button
                    type="button"
                    onClick={
                      saveTemplateDetails
                    }
                  >
                    Save Template Details
                  </button>
                </div>

                <div className="card">
                  <h3>Add Exercise</h3>

                  <form
                    className="inline-form exercise-add-form"
                    onSubmit={addExercise}
                  >
                    <ExerciseAutocomplete
                      exercises={exercises}
                      value={exerciseName}
                      onChange={setExerciseName}
                    />

                    <button type="submit">
                      Add Exercise
                    </button>
                  </form>
                </div>

                <div className="template-exercise-list">
                  {selectedTemplate.exercises
                    .length ? (
                    selectedTemplate.exercises.map(
                      (
                        templateExercise,
                        index
                      ) => (
                        <TemplateExerciseEditor
                          key={
                            templateExercise.id
                          }
                          templateExercise={
                            templateExercise
                          }
                          exerciseName={getExerciseName(
                            templateExercise.exerciseId
                          )}
                          isFirst={index === 0}
                          isLast={
                            index ===
                            selectedTemplate
                              .exercises.length -
                              1
                          }
                        />
                      )
                    )
                  ) : (
                    <div className="card">
                      <p>
                        No exercises have been
                        added to this template.
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="card">
                <p>
                  Select a template to edit it.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p>
          No workout templates have been
          created yet.
        </p>
      )}
    </section>
  );
}