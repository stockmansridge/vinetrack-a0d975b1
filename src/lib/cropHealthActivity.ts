// Stored outcomes never prove execution. Legacy jobs have no fenced lease.
export function historicalTimelineStatus(outcome: string): "queued" | "cloud" | "no_capture" | "failed" {
  if (outcome === "cloud_obscured" || outcome === "invalid_coverage") return "cloud";
  if (outcome === "no_provider_capture") return "no_capture";
  if (outcome === "failed") return "failed";
  return "queued";
}
export function hasLiveLease(item: { status?: string; lease_expires_at?: string | null; heartbeat_at?: string | null }, now = Date.now()): boolean {
  const expiry = Date.parse(item.lease_expires_at ?? ""), beat = Date.parse(item.heartbeat_at ?? "");
  return item.status === "leased" && expiry > now && beat <= now && beat > now - 90_000;
}