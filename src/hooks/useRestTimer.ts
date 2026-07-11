import { useCallback, useEffect, useRef, useState } from "react";

export type RestTimerStart = {
  workoutId: number;
  workoutExerciseId: number;
  setId: number;
  exerciseName: string;
  setNumber: number;
  durationSeconds: number;
};

export type RestTimer = RestTimerStart & {
  targetTime: number | null;
  remainingMs: number;
  expired: boolean;
};

export function useRestTimer() {
  const [timer, setTimer] = useState<RestTimer | null>(null);
  const feedbackTimerKey = useRef<string | null>(null);

  const start = useCallback((details: RestTimerStart) => {
    const durationSeconds = Math.max(0, Math.floor(details.durationSeconds));
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return;
    const remainingMs = durationSeconds * 1000;
    feedbackTimerKey.current = null;
    setTimer({
      ...details,
      durationSeconds,
      remainingMs,
      targetTime: Date.now() + remainingMs,
      expired: false
    });
  }, []);

  useEffect(() => {
    if (!timer?.targetTime || timer.expired) return;

    const update = () => {
      setTimer((current) => {
        if (!current?.targetTime || current.expired) return current;
        const remainingMs = Math.max(0, current.targetTime - Date.now());
        return remainingMs === 0
          ? { ...current, remainingMs: 0, targetTime: null, expired: true }
          : { ...current, remainingMs };
      });
    };

    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [timer?.targetTime, timer?.expired]);

  useEffect(() => {
    if (!timer?.expired) return;
    const key = `${timer.workoutExerciseId}:${timer.setId}:${timer.durationSeconds}`;
    if (feedbackTimerKey.current === key) return;
    feedbackTimerKey.current = key;
    try {
      navigator.vibrate?.(150);
    } catch {
      // Completion feedback is best-effort only.
    }
  }, [timer]);

  const pause = useCallback(() => {
    setTimer((current) => {
      if (!current?.targetTime || current.expired) return current;
      const remainingMs = Math.max(0, current.targetTime - Date.now());
      return {
        ...current,
        remainingMs,
        targetTime: null,
        expired: remainingMs === 0
      };
    });
  }, []);

  const resume = useCallback(() => {
    setTimer((current) => {
      if (!current || current.targetTime || current.expired || current.remainingMs <= 0) return current;
      return { ...current, targetTime: Date.now() + current.remainingMs };
    });
  }, []);

  const reset = useCallback(() => {
    setTimer((current) => {
      if (!current) return current;
      const remainingMs = current.durationSeconds * 1000;
      feedbackTimerKey.current = null;
      return { ...current, remainingMs, targetTime: Date.now() + remainingMs, expired: false };
    });
  }, []);

  const adjust = useCallback((seconds: number) => {
    setTimer((current) => {
      if (!current) return current;
      const currentRemainingMs = current.targetTime
        ? Math.max(0, current.targetTime - Date.now())
        : current.remainingMs;
      const remainingMs = Math.max(0, currentRemainingMs + seconds * 1000);
      const expired = remainingMs === 0;
      if (!expired) feedbackTimerKey.current = null;
      return {
        ...current,
        remainingMs,
        targetTime: current.targetTime && remainingMs > 0 ? Date.now() + remainingMs : null,
        expired
      };
    });
  }, []);

  const dismiss = useCallback(() => setTimer(null), []);

  return { timer, start, pause, resume, reset, adjust, dismiss };
}
