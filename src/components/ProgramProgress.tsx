import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getProgramProgress } from "../data/programProgressRepository";
import type { ProgramCycleProgress, ProgramExerciseComparisonState } from "../utils/programProgress";
import { compareProgramCycles } from "../utils/programProgress";
import { WORKOUT_EXERCISE_QUALITY_FLAGS, WORKOUT_EXERCISE_QUALITY_FLAG_LABELS } from "../utils/qualityFlags";
import { formatReps } from "../utils/setFormatting";

type Props = {
  programId: number;
  currentStatus?: string;
  onViewExerciseHistory?: (exerciseId: number) => void;
};

const comparisonLabels: Record<ProgramExerciseComparisonState, string> = {
  improved: "Improved",
  same: "Same",
  down: "Down",
  new: "New",
  not_performed: "Not performed",
  not_yet_performed: "Not yet performed"
};

function performanceText(
  value: NonNullable<ProgramCycleProgress["exercises"][number]["best"]>,
  type: ProgramCycleProgress["exercises"][number]["measurementType"],
  unit: "lb" | "kg"
) {
  const reps = formatReps(value.set);
  if (type === "reps_only") return reps;
  if (type === "bodyweight_added_weight") {
    return value.set.weight
      ? `Bodyweight + ${value.set.weight} ${unit} × ${reps}`
      : `Bodyweight × ${reps}`;
  }
  return `${value.set.weight} ${unit} × ${reps}`;
}

function QualitySummary({ cycle }: { cycle: ProgramCycleProgress }) {
  if (!cycle.qualityFlagSessionCount) return <p className="review-empty">No quality flags in this cycle.</p>;
  return <div className="program-quality-list">{WORKOUT_EXERCISE_QUALITY_FLAGS.flatMap((flag) => {
    const count = cycle.qualityFlags[flag];
    if (!count) return [];
    const exercises = cycle.qualityExercises[flag] ?? [];
    return [<div className="program-quality-row" key={flag}>
      <span><strong>{WORKOUT_EXERCISE_QUALITY_FLAG_LABELS[flag]}</strong>: {count} session{count === 1 ? "" : "s"}</span>
      {exercises.length > 0 && <small>{exercises.join(", ")}</small>}
    </div>];
  })}</div>;
}

export function ProgramProgress({ programId, currentStatus, onViewExerciseHistory }: Props) {
  const progress = useLiveQuery(() => getProgramProgress(programId), [programId]);
  const [selectedCycle, setSelectedCycle] = useState<"all" | number>("all");
  const comparableCycles = progress?.cycles.filter((cycle) => cycle.exercises.length > 0) ?? [];
  const comparisonOptions = comparableCycles.slice(1).map((later, index) => ({
    earlier: comparableCycles[index].cycleNumber,
    later: later.cycleNumber
  }));
  const [selectedPairIndex, setSelectedPairIndex] = useState<number | null>(null);
  const pairIndex = selectedPairIndex !== null && comparisonOptions[selectedPairIndex]
    ? selectedPairIndex
    : Math.max(0, comparisonOptions.length - 1);
  const pair = comparisonOptions[pairIndex];
  const comparison = progress && pair ? compareProgramCycles(progress, pair.earlier, pair.later) : undefined;

  if (progress === undefined) return <div className="card"><p className="muted">Loading Program progress…</p></div>;
  if (!progress) return null;
  const visibleCycles = selectedCycle === "all"
    ? progress.cycles
    : progress.cycles.filter((cycle) => cycle.cycleNumber === selectedCycle);
  const chartData = progress.cycles.map((cycle) => ({
    name: `Cycle ${cycle.cycleNumber}`,
    PR: cycle.prCount,
    "SET PR": cycle.setPrCount
  }));

  return <details className="card program-analytics" open>
    <summary><strong>Program Progress</strong></summary>
    <div className="program-metrics">
      <span><strong>{progress.summary.workoutCount}</strong> workouts</span>
      <span><strong>{progress.summary.completedCycleCount}</strong> completed cycle{progress.summary.completedCycleCount === 1 ? "" : "s"}</span>
      <span><strong>{progress.summary.prCount}</strong> PRs</span>
      <span><strong>{progress.summary.setPrCount}</strong> SET PRs</span>
      <span><strong>{progress.summary.exerciseCount}</strong> exercises</span>
      <span><strong>{progress.summary.qualityFlagSessionCount}</strong> flagged sessions</span>
    </div>
    {currentStatus && <p className="program-current-status"><strong>Current:</strong> {currentStatus}</p>}
    {progress.summary.workoutsWithoutCycleProvenance > 0 && <p className="muted">
      {progress.summary.workoutsWithoutCycleProvenance} older Program workout{progress.summary.workoutsWithoutCycleProvenance === 1 ? " has" : "s have"} no cycle snapshot. Included in totals, excluded from cycle views.
    </p>}
    {!progress.summary.workoutCount && <p className="review-empty">Complete Program workouts to see progress analytics.</p>}

    {progress.cycles.length > 0 && <>
      {progress.cycles.length >= 2 && <label className="field-label program-cycle-filter">Cycle view
        <select value={selectedCycle} onChange={(event) => setSelectedCycle(event.target.value === "all" ? "all" : Number(event.target.value))}>
          <option value="all">All Cycles</option>
          {progress.cycles.map((cycle) => <option value={cycle.cycleNumber} key={cycle.cycleNumber}>
            Cycle {cycle.cycleNumber}{cycle.isInProgress ? " · In progress" : ""}
          </option>)}
        </select>
      </label>}

      <section className="program-analytics-section">
        <h4>Cycle coverage</h4>
        <div className="program-cycle-list">{visibleCycles.map((cycle) => <div className="program-cycle-row" key={cycle.cycleNumber}>
          <strong>Cycle {cycle.cycleNumber}{cycle.isInProgress ? " · In progress" : cycle.isComplete ? " · Complete" : ""}</strong>
          <span>{cycle.workoutCount} completed workout{cycle.workoutCount === 1 ? "" : "s"}</span>
          {cycle.plannedWorkoutCount > 0 && <small>{cycle.completedSlotCount} / {cycle.plannedWorkoutCount} current planned slots covered</small>}
        </div>)}</div>
      </section>

      {comparisonOptions.length > 0 ? <section className="program-analytics-section">
        <div className="program-section-heading"><h4>Cycle comparison</h4>
          {comparisonOptions.length > 1 && <label className="field-label compact-program-select">Compare
            <select value={pairIndex} onChange={(event) => setSelectedPairIndex(Number(event.target.value))}>
              {comparisonOptions.map((option, index) => <option key={`${option.earlier}-${option.later}`} value={index}>
                Cycle {option.earlier} → Cycle {option.later}
              </option>)}
            </select>
          </label>}
        </div>
        {comparison && <>
          <p className="muted">Best qualifying performance in Cycle {comparison.laterCycle} compared with Cycle {comparison.earlierCycle}.{comparison.laterIsInProgress ? " The newer cycle is still in progress." : ""}</p>
          <div className="program-comparison-counts">
            <span><strong>{comparison.counts.improved}</strong> Improved</span>
            <span><strong>{comparison.counts.same}</strong> Same</span>
            <span><strong>{comparison.counts.down}</strong> Down</span>
            <span><strong>{comparison.counts.notComparable}</strong> New / not comparable</span>
          </div>
          <div className="program-exercise-comparisons">{comparison.exercises.map((item) => <details className="program-exercise-comparison" key={item.exerciseId}>
            <summary>
              <span><strong>{item.exerciseName}</strong><small>{item.earlier?.best && item.later?.best
                ? `${performanceText(item.earlier.best, item.measurementType, item.unit)} → ${performanceText(item.later.best, item.measurementType, item.unit)}`
                : item.later?.best
                  ? `Cycle ${comparison.laterCycle}: ${performanceText(item.later.best, item.measurementType, item.unit)}`
                  : item.earlier?.best
                    ? `Cycle ${comparison.earlierCycle}: ${performanceText(item.earlier.best, item.measurementType, item.unit)}`
                    : "No qualifying performance"}</small></span>
              <span className={`program-change-badge program-change-${item.state}`}>{comparisonLabels[item.state]}{item.state === "new" ? ` in Cycle ${comparison.laterCycle}` : item.state === "not_performed" ? ` in Cycle ${comparison.laterCycle}` : ""}</span>
            </summary>
            <div className="program-exercise-detail">
              {item.earlier?.best && <span>Cycle {comparison.earlierCycle} best: {item.earlier.best.date} · {item.earlier.prCount} PR · {item.earlier.setPrCount} SET PR</span>}
              {item.later?.best && <span>Cycle {comparison.laterCycle} best: {item.later.best.date} · {item.later.prCount} PR · {item.later.setPrCount} SET PR</span>}
              {item.noCycleImprovement && <span className="program-stagnation-label">No cycle improvement</span>}
              {onViewExerciseHistory && <button className="secondary-button tiny-button" onClick={() => onViewExerciseHistory(item.exerciseId)}>Exercise History</button>}
            </div>
          </details>)}</div>
        </>}
      </section> : progress.cycles.length > 0 && <p className="review-empty">At least two cycles with performance data are needed for comparison.</p>}

      <section className="program-analytics-section">
        <h4>Records by cycle</h4>
        <div className="program-record-list">{visibleCycles.map((cycle) => <span key={cycle.cycleNumber}>
          <strong>Cycle {cycle.cycleNumber}</strong> {cycle.prCount} PR · {cycle.setPrCount} SET PR
        </span>)}</div>
        {selectedCycle === "all" && chartData.length >= 2 && <div className="program-record-chart" aria-label="PR and SET PR events by cycle">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 5, bottom: 0, left: -24 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="PR" fill="var(--accent-strong)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="SET PR" fill="var(--muted-text)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>}
      </section>

      <section className="program-analytics-section">
        <h4>Quality flags</h4>
        {visibleCycles.map((cycle) => <div className="program-cycle-quality" key={cycle.cycleNumber}>
          {selectedCycle === "all" && <strong>Cycle {cycle.cycleNumber}</strong>}
          <QualitySummary cycle={cycle} />
        </div>)}
      </section>
    </>}
  </details>;
}
