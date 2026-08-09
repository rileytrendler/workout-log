import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Exercise, ExerciseMeasurementType } from "../db/types";
import type { ExerciseHistorySession } from "../data/workoutRepository";
import { formatSetPerformance } from "../utils/setFormatting";
import type { PersonalRecordStatus } from "../utils/personalRecords";
import {
  buildExerciseProgressSeries,
  filterExerciseProgressRange,
  getObservedWorkingSetNumbers,
  type ExerciseProgressMetric,
  type ExerciseProgressPoint,
  type ExerciseProgressRange
} from "../utils/exerciseProgress";

type Props = {
  sessions: ExerciseHistorySession[];
  measurementType: ExerciseMeasurementType;
  exercise: Exercise;
  personalRecordStatuses?: ReadonlyMap<number, PersonalRecordStatus>;
};

const rangeOptions: Array<{ value: ExerciseProgressRange; label: string }> = [
  { value: "all", label: "All" },
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "1y", label: "1Y" }
];

function shortDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}

function fullDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })
    : date;
}

function ProgressTooltip({ active, payload, measurementType, exercise, metric }: {
  active?: boolean;
  payload?: Array<{ payload: ExerciseProgressPoint }>;
  measurementType: ExerciseMeasurementType;
  exercise: Exercise;
  metric: ExerciseProgressMetric;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const recordLabel = point.recordStatus?.isAbsolutePR
    ? "PR"
    : point.recordStatus?.isSetPR ? "SET PR" : undefined;
  return <div className="progress-chart-tooltip">
    <strong>{fullDate(point.date)}</strong>
    <span>{formatSetPerformance(point.set, measurementType, exercise)}</span>
    {metric !== "best" && <span className="muted">Set {point.set.setNumber}</span>}
    {point.set.actualRpe !== undefined && <span className="muted">RPE {point.set.actualRpe}</span>}
    {point.gymName && <span className="muted">{point.gymName}</span>}
    {recordLabel && <span className={`pr-badge${recordLabel === "SET PR" ? " set-pr-badge" : ""}`}>{recordLabel}</span>}
  </div>;
}

export function ExerciseProgressChart({ sessions, measurementType, exercise, personalRecordStatuses }: Props) {
  const [metric, setMetric] = useState<ExerciseProgressMetric>("best");
  const [range, setRange] = useState<ExerciseProgressRange>("all");
  const setNumbers = useMemo(
    () => getObservedWorkingSetNumbers(sessions, measurementType),
    [sessions, measurementType]
  );
  const metricSetNumbers = typeof metric === "number" && !setNumbers.includes(metric)
    ? [...setNumbers, metric].sort((a, b) => a - b)
    : setNumbers;
  const allPoints = useMemo(
    () => buildExerciseProgressSeries(sessions, measurementType, metric, personalRecordStatuses),
    [sessions, measurementType, metric, personalRecordStatuses]
  );
  const points = useMemo(
    () => filterExerciseProgressRange(allPoints, range),
    [allPoints, range]
  );
  const yLabel = measurementType === "reps_only" ? "Effective reps" : `Weight (${exercise.defaultUnit})`;
  const xDomain = points.length === 1
    ? [points[0].chartTime - 43_200_000, points[0].chartTime + 43_200_000]
    : ["dataMin", "dataMax"];

  return <details className="card exercise-progress" open>
    <summary><span><strong>Progress</strong><small>{yLabel}</small></span></summary>
    <div className="progress-controls">
      <label className="field-label">Metric
        <select value={metric} onChange={(event) => setMetric(event.target.value === "best" ? "best" : Number(event.target.value))}>
          <option value="best">Best Set</option>
          {metricSetNumbers.map((setNumber) => <option key={setNumber} value={setNumber}>Set {setNumber}</option>)}
        </select>
      </label>
      <div className="progress-range" aria-label="Chart time range">
        {rangeOptions.map((option) => <button key={option.value} type="button"
          className={range === option.value ? "active" : ""}
          aria-pressed={range === option.value}
          onClick={() => setRange(option.value)}>{option.label}</button>)}
      </div>
    </div>
    {!points.length ? <p className="progress-empty">No completed working sets for this selection.</p> : <>
      <div className="progress-chart" role="img" aria-label={`${metric === "best" ? "Best set" : `Set ${metric}`} ${yLabel.toLowerCase()} over time`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 12, right: 12, bottom: 2, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="chartTime" type="number" scale="time" domain={xDomain}
              tickFormatter={shortDate} tick={{ fontSize: 11, fill: "var(--muted-text)" }}
              tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={24} />
            <YAxis dataKey="value" domain={["auto", "auto"]} width={44}
              tick={{ fontSize: 11, fill: "var(--muted-text)" }}
              tickLine={false} axisLine={false} allowDecimals />
            <Tooltip content={<ProgressTooltip measurementType={measurementType} exercise={exercise} metric={metric} />}
              cursor={{ stroke: "var(--accent)", strokeDasharray: "3 3" }} />
            <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2.5}
              dot={{ r: 4, fill: "var(--surface)", strokeWidth: 2 }}
              activeDot={{ r: 6, fill: "var(--accent)" }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {points.length === 1 && <p className="muted progress-trend-note">Need another session for a trend.</p>}
    </>}
  </details>;
}
