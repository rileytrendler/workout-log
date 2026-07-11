import { useMemo, useRef, useState } from "react";
import type { Exercise } from "../db/types";

type ExerciseAutocompleteProps = {
  exercises: Exercise[];
  value: string;
  onChange: (value: string) => void;
};

export function ExerciseAutocomplete({ exercises, value, onChange }: ExerciseAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);

  const trimmedValue = value.trim();

  const matchingExercises = useMemo(() => {
    const search = trimmedValue.toLowerCase();

    return exercises
      .filter((exercise) => {
        if (!search) return true;
        return exercise.name.toLowerCase().includes(search);
      })
      .sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();

        const aStartsWith = search && aName.startsWith(search);
        const bStartsWith = search && bName.startsWith(search);

        if (aStartsWith && !bStartsWith) return -1;
        if (!aStartsWith && bStartsWith) return 1;

        return aName.localeCompare(bName);
      })
      .slice(0, 8);
  }, [exercises, trimmedValue]);

  const exactMatch = exercises.some(
    (exercise) => exercise.name.toLowerCase() === trimmedValue.toLowerCase()
  );

  function handleFocus() {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
    }

    setIsOpen(true);
  }

  function handleBlur() {
    closeTimeoutRef.current = window.setTimeout(() => {
      setIsOpen(false);
    }, 150);
  }

  function selectExercise(name: string) {
    onChange(name);
    setIsOpen(false);
  }

  return (
    <div className="exercise-autocomplete">
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        autoComplete="off"
        placeholder="Search or create exercise"
      />

      {isOpen && matchingExercises.length > 0 && (
        <div className="exercise-suggestions">
          {matchingExercises.map((exercise) => (
            <button
              type="button"
              className="exercise-suggestion"
              key={exercise.id}
              onMouseDown={(event) => event.preventDefault()}
              onTouchStart={(event) => event.currentTarget.focus()}
              onClick={() => selectExercise(exercise.name)}
            >
              {exercise.name}
            </button>
          ))}
        </div>
      )}

      {trimmedValue && (
        <p className="input-hint">
          {exactMatch ? "Using existing exercise." : "New exercise will be created."}
        </p>
      )}
    </div>
  );
}