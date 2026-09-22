import { describe, expect, it } from "vitest";
import {
  decorateFeatureRequests,
  filterFeatureRequests,
  isBackendPendingError,
  type FeatureRequestRow,
} from "@/lib/featureRequestsQuery";

const row = (id: string, title: string, created_at: string): FeatureRequestRow => ({
  id,
  title,
  details: null,
  status: "open",
  is_hidden: false,
  created_by: "u1",
  created_by_name: "Jo Grower",
  admin_note: null,
  created_at,
});

describe("feature request board", () => {
  const rows = [
    row("a", "Bulk spray import", "2026-09-01T00:00:00Z"),
    row("b", "Dark mode maps", "2026-09-02T00:00:00Z"),
    row("c", "Offline pins", "2026-09-03T00:00:00Z"),
  ];
  const votes = [
    { feature_request_id: "a", user_id: "u1" },
    { feature_request_id: "a", user_id: "u2" },
    { feature_request_id: "b", user_id: "u2" },
  ];

  it("counts votes and sorts highest first", () => {
    const out = decorateFeatureRequests(rows, votes, "u1");
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(out[0].votes).toBe(2);
    expect(out[2].votes).toBe(0);
  });

  it("marks the viewer's own vote only", () => {
    const out = decorateFeatureRequests(rows, votes, "u1");
    expect(out.find((r) => r.id === "a")!.hasVoted).toBe(true);
    expect(out.find((r) => r.id === "b")!.hasVoted).toBe(false);
  });

  it("breaks vote ties with the newest request first", () => {
    const out = decorateFeatureRequests(rows, [], null);
    expect(out.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("filters by search text and status", () => {
    const list = decorateFeatureRequests(rows, votes, "u1");
    expect(filterFeatureRequests(list, "offline", "all").map((r) => r.id)).toEqual(["c"]);
    expect(filterFeatureRequests(list, "", "planned")).toEqual([]);
    expect(filterFeatureRequests(list, "jo grower", "all")).toHaveLength(3);
  });

  it("recognises a missing table as backend-pending", () => {
    expect(isBackendPendingError({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(isBackendPendingError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isBackendPendingError(null)).toBe(false);
  });
});
