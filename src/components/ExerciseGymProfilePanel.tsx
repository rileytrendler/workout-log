import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  getExerciseGymProfile,
  upsertExerciseGymProfile
} from "../data/exerciseGymProfileRepository";

type Props = {
  exerciseId: number;
  gymId?: number;
  gymName?: string;
};

export function ExerciseGymProfilePanel({ exerciseId, gymId, gymName }: Props) {
  const profile = useLiveQuery(
    () => gymId ? getExerciseGymProfile(exerciseId, gymId) : undefined,
    [exerciseId, gymId]
  );
  const [isEditing, setIsEditing] = useState(false);

  if (!gymId) {
    return <div className="gym-setup-panel muted">Select a gym to save gym-specific setup.</div>;
  }

  if (!isEditing) {
    const summary = [profile?.equipmentName, profile?.setupNotes]
      .filter(Boolean)
      .join(" · ");
    return (
      <div className="gym-setup-panel">
        <div className="gym-setup-summary">
          <div>
            <strong>Gym Setup — {gymName ?? "Selected gym"}</strong>
            <p className="muted">{summary || "No setup saved yet."}</p>
          </div>
          <button className="secondary-button" onClick={() => setIsEditing(true)}>
            {profile ? "Edit" : "Add"}
          </button>
        </div>
      </div>
    );
  }

  return <GymSetupForm
    key={`${exerciseId}-${gymId}-${profile?.updatedAt ?? "new"}`}
    exerciseId={exerciseId}
    gymId={gymId}
    gymName={gymName}
    initialEquipmentName={profile?.equipmentName}
    initialSetupNotes={profile?.setupNotes}
    initialCalibrationNotes={profile?.calibrationNotes}
    onClose={() => setIsEditing(false)}
  />;
}

type GymSetupFormProps = {
  exerciseId: number;
  gymId: number;
  gymName?: string;
  initialEquipmentName?: string;
  initialSetupNotes?: string;
  initialCalibrationNotes?: string;
  onClose: () => void;
};

function GymSetupForm({
  exerciseId,
  gymId,
  gymName,
  initialEquipmentName,
  initialSetupNotes,
  initialCalibrationNotes,
  onClose
}: GymSetupFormProps) {
  const [equipmentName, setEquipmentName] = useState(initialEquipmentName ?? "");
  const [setupNotes, setSetupNotes] = useState(initialSetupNotes ?? "");
  const [calibrationNotes, setCalibrationNotes] = useState(initialCalibrationNotes ?? "");

  async function save() {
    await upsertExerciseGymProfile(exerciseId, gymId, {
      equipmentName,
      setupNotes,
      calibrationNotes
    });
    onClose();
  }

  return (
    <div className="gym-setup-panel gym-setup-editor">
      <strong>Gym Setup — {gymName ?? "Selected gym"}</strong>
      <label className="field-label">Equipment / Machine
        <input value={equipmentName} onChange={(event) => setEquipmentName(event.target.value)} placeholder="Machine name or model" />
      </label>
      <label className="field-label">Setup / Settings
        <textarea value={setupNotes} onChange={(event) => setSetupNotes(event.target.value)} placeholder="Seat, backrest, pin, cable, handle..." />
      </label>
      <label className="field-label">Calibration / Machine Notes
        <textarea value={calibrationNotes} onChange={(event) => setCalibrationNotes(event.target.value)} placeholder="Stack feel, range of motion, local quirks..." />
      </label>
      <div className="button-row">
        <button onClick={save}>Save Gym Setup</button>
        <button className="secondary-button" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
