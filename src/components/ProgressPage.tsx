import { useLiveQuery } from "dexie-react-hooks";
import { getWeeklyReview } from "../data/weeklyReviewRepository";
import { WORKOUT_EXERCISE_QUALITY_FLAG_LABELS } from "../utils/qualityFlags";

function delta(current: number, previous: number) {
  const difference = current - previous;
  return difference === 0 ? "same" : `${difference > 0 ? "+" : ""}${difference}`;
}

function plural(value: number, singular: string, pluralForm = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

export function ProgressPage() {
  const review = useLiveQuery(() => getWeeklyReview(), []);
  if (!review) return <section><h2>Progress</h2><p>Loading Weekly Review…</p></section>;
  const metrics = [
    ["Workouts", review.current.workoutCount, review.previous.workoutCount],
    ["Exercise sessions", review.current.exerciseSessionCount, review.previous.exerciseSessionCount],
    ["PRs", review.current.absolutePRCount, review.previous.absolutePRCount],
    ["SET PRs", review.current.setPRCount, review.previous.setPRCount]
  ] as const;

  return <section className="progress-page">
    <h2>Progress</h2>
    <section className="card weekly-review-summary">
      <h3>Last 7 days</h3>
      <div className="review-metrics">{metrics.map(([label, current, previous]) =>
        <div className="review-metric" key={label}><span>{label}</span><strong>{current}</strong>
          <small>{delta(current, previous)} · {previous} previous</small></div>)}</div>
    </section>

    <section className="review-section">
      <h3>Improved</h3>
      {review.improvedExercises.length ? <div className="review-list">{review.improvedExercises.map((item) => {
        const details = [
          item.absolutePRCount ? plural(item.absolutePRCount, "PR") : "",
          item.setPRCount ? plural(item.setPRCount, "SET PR") : ""
        ].filter(Boolean).join(" · ");
        return <article className="mini-card review-row" key={item.exerciseId}>
          <strong>{item.exerciseName}</strong><span className="muted">{details}</span>
        </article>;
      })}</div> : <p className="review-empty">No PRs in the last 7 days.</p>}
    </section>

    <section className="review-section">
      <h3>Stagnation watch</h3>
      {review.stagnationWatch.length ? <div className="review-list">{review.stagnationWatch.map((item) =>
        <article className="mini-card review-row" key={item.exerciseId}>
          <div><strong>{item.exerciseName}</strong>{item.severity === "stagnant" && <span className="review-status">Stagnant</span>}</div>
          <span className="muted">No PR in {item.daysSinceProgress} days · {plural(item.sessionCount, "session")}</span>
        </article>)}</div> : <p className="review-empty">No exercises currently meet the stagnation-watch criteria.</p>}
    </section>

    <section className="review-section">
      <h3>Quality flags</h3>
      {review.qualityFlagSummary.length ? <div className="review-list">{review.qualityFlagSummary.map((item) =>
        <article className={`mini-card review-row${item.flags.some(({ flag }) => flag === "form_issue") ? " form-issue-row" : ""}`} key={item.exerciseId}>
          <strong>{item.exerciseName}</strong>
          <span className="review-flag-list">{item.flags.map(({ flag, sessionCount }) =>
            <span className="review-flag" key={flag}>{WORKOUT_EXERCISE_QUALITY_FLAG_LABELS[flag]}
              {sessionCount > 1 && <span className="muted"> · {plural(sessionCount, "session")}</span>}</span>
          )}</span>
        </article>)}</div> : <p className="review-empty">No quality flags in the last 7 days.</p>}
    </section>
  </section>;
}
