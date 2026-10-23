// Turns raw database/save errors into plain-English messages for Work Task
// labour and machine lines. Unknown errors fall back to a generic message.
const FIELD_LABELS: Record<string, string> = {
  work_date: "Work date",
  equipment_name_snapshot: "Equipment",
  worker_count: "Number of workers",
  hours_per_worker: "Hours per worker",
  hourly_rate: "Hourly rate",
  task_type: "Task type",
};

export function friendlySaveError(err: unknown, thing = "this record"): string {
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? String(err ?? "");
  const nn = msg.match(/null value in column "([^"]+)"/i);
  if (nn) {
    const label = FIELD_LABELS[nn[1]] ?? "A required field";
    return `${label} is missing. Please set one, then press save again.`;
  }
  if (/not-null|violates check constraint|23502|23514/i.test(msg)) {
    return "A required field is missing or invalid. Please check the details and press save again.";
  }
  if (/row-level security|permission denied|42501/i.test(msg)) {
    return `You don't have permission to save ${thing} for this vineyard.`;
  }
  if (/sync_version|conflict|stale|updated by another/i.test(msg)) {
    return `${thing[0].toUpperCase()}${thing.slice(1)} was changed on another device. Please refresh to see the latest version.`;
  }
  if (/failed to fetch|network/i.test(msg)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return msg && !/violates|relation "|column "/i.test(msg)
    ? msg
    : "Something went wrong while saving. Please try again.";
}
