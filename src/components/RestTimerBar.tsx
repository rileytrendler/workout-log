import type { RestTimer } from "../hooks/useRestTimer";

type Props = {
  timer: RestTimer;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onAdjust: (seconds: number) => void;
  onDismiss: () => void;
};

function formatRemaining(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function RestTimerBar({ timer, onPause, onResume, onReset, onAdjust, onDismiss }: Props) {
  const paused = !timer.targetTime && !timer.expired;
  return (
    <aside className={`rest-timer${timer.expired ? " rest-timer-expired" : ""}`} aria-live="polite">
      <div className="rest-timer-status">
        <span className="rest-timer-label">{timer.exerciseName} · Set {timer.setNumber}</span>
        <strong>{timer.expired ? "Rest complete" : formatRemaining(timer.remainingMs)}</strong>
        <span className="muted">Prescribed {Math.floor(timer.durationSeconds / 60)}:{(timer.durationSeconds % 60).toString().padStart(2, "0")}</span>
      </div>
      <div className="rest-timer-controls">
        <button type="button" className="secondary-button" onClick={paused ? onResume : onPause} disabled={timer.expired}>{paused ? "Resume" : "Pause"}</button>
        <button type="button" className="secondary-button" onClick={onReset}>Reset</button>
        <button type="button" className="secondary-button" onClick={() => onAdjust(15)} aria-label="Add 15 seconds">+15</button>
        <button type="button" className="secondary-button" onClick={() => onAdjust(-15)} aria-label="Subtract 15 seconds">−15</button>
        <button type="button" className="secondary-button danger" onClick={onDismiss}>Dismiss</button>
      </div>
    </aside>
  );
}
