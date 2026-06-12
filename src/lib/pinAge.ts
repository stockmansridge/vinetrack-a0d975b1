// Pin age helpers for map display modes.
// Display-only — does not mutate or persist any pin data.

export type PinAgeBucket = "new" | "recent" | "aging" | "old" | "unknown";

export const PIN_AGE_COLOURS: Record<PinAgeBucket, string> = {
  new: "#2EAD4B",
  recent: "#F2C94C",
  aging: "#F2994A",
  old: "#D64545",
  unknown: "#9CA3AF",
};

export const PIN_AGE_LABELS: Record<PinAgeBucket, string> = {
  new: "0–7 days",
  recent: "8–30 days",
  aging: "31–90 days",
  old: "90+ days",
  unknown: "Unknown date",
};

export function getPinAgeDays(createdAt?: string | null): number | null {
  if (!createdAt) return null;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
}

export function getPinAgeBucket(createdAt?: string | null): PinAgeBucket {
  const d = getPinAgeDays(createdAt);
  if (d == null || d < 0) return "unknown";
  if (d <= 7) return "new";
  if (d <= 30) return "recent";
  if (d <= 90) return "aging";
  return "old";
}

export function pinAgeColor(createdAt?: string | null): string {
  return PIN_AGE_COLOURS[getPinAgeBucket(createdAt)];
}
