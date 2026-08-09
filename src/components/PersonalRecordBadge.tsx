import type { PersonalRecordStatus } from "../utils/personalRecords";

export function PersonalRecordBadge({ status }: { status?: PersonalRecordStatus }) {
  if (status?.isAbsolutePR) return <span className="pr-badge">PR</span>;
  if (status?.isSetPR) return <span className="pr-badge set-pr-badge">SET PR</span>;
  return null;
}
