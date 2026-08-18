// Stage 3C — history projection parity.
//
// These tests exist because the dangerous failure of a resistance check is not
// a wrong number: it is silence. Every one of them asserts that something the
// portal does NOT know stays visible instead of disappearing into a clean
// result.
import { describe, expect, it } from "vitest";
import {
  buildResistanceEvents,
  eventInputFromSprayRecord,
  hasUnresolvedBlockAttribution,
  productLinesFromRecord,
  recordTargets,
  unresolvedApplicationsConcerning,
} from "@/lib/resistance/resistanceEventSource";
import { makeSeasonCalendar, seasonForEpochMs } from "@/lib/resistance/resistanceSeason";

const calendar = makeSeasonCalendar({ startMonth: 7, startDay: 1 });

const snapshot = (groups: string[], status = "verified") => ({
  saved_chemical_id: "chem-1",
  product_name: "Test Product",
  active_ingredients: [],
  activity_groups: groups,
  verification_status: status,
  schema_version: 1,
  activity_group_table_version: 1,
});

function record(over: Record<string, any> = {}): Record<string, any> {
  return {
    id: "rec-1",
    vineyard_id: "v1",
    date: "2026-09-01",
    start_time: "08:00",
    end_time: "11:00",
    is_template: false,
    deleted_at: null,
    targets: ["powdery_mildew"],
    application_blocks: [{ blockId: "block-a" }],
    tanks: [{ chemicals: [{ id: "l1", name: "Test", chemicalSnapshot: snapshot(["11"]) }] }],
    ...over,
  };
}

const project = (rows: Record<string, any>[]) =>
  buildResistanceEvents(rows.map(eventInputFromSprayRecord), calendar);

describe("history projection sources", () => {
  it("reads blocks from application_blocks, not from current geometry", () => {
    const out = project([record({ application_blocks: [{ blockId: "block-a" }, { blockId: "block-c" }] })]);
    expect(out.events.map((e) => e.blockId).sort()).toEqual(["block-a", "block-c"]);
    expect(out.unresolvedBlockApplications).toHaveLength(0);
  });

  it("reads targets from spray_records.targets", () => {
    expect(recordTargets(record({ targets: ["downy_mildew"] }))).toEqual(["downy_mildew"]);
    expect(recordTargets(record({ targets: [] }))).toEqual([]);
  });

  it("reads chemistry from the frozen snapshot and never from live Saved Chemicals", () => {
    const lines = productLinesFromRecord(
      record({
        tanks: [
          {
            chemicals: [
              {
                id: "l1",
                // A name that resolves to different chemistry today must not
                // change the historical classification.
                name: "Renamed Product",
                savedChemicalId: "chem-1",
                chemicalSnapshot: snapshot(["3"]),
              },
            ],
          },
        ],
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].groups.codes).toEqual(["3"]);
    expect(lines[0].productName).toBe("Test Product");
    expect(lines[0].availability).toBe("available_verified");
  });
});

describe("uncertainty is retained, never collapsed", () => {
  it("unknown block attribution stays unresolved history", () => {
    const out = project([record({ application_blocks: null, block_ids: null })]);
    expect(out.events).toHaveLength(0);
    expect(hasUnresolvedBlockAttribution(out)).toBe(true);
    const seasonId = seasonForEpochMs(calendar, Date.parse("2026-09-01T08:00:00")).id;
    expect(unresolvedApplicationsConcerning(out, "powdery_mildew", seasonId)).toHaveLength(1);
  });

  it("unknown targets stay unknown rather than becoming 'no targets'", () => {
    expect(recordTargets(record({ targets: null }))).toBeNull();
    const out = project([record({ targets: null })]);
    expect(out.events[0].targetsRecorded).toBe(false);
    expect(out.events[0].targets).toEqual([]);
  });

  it("an unattributed spray with unknown targets may concern any disease", () => {
    const out = project([record({ application_blocks: null, targets: null })]);
    for (const disease of ["powdery_mildew", "downy_mildew"] as const) {
      expect(unresolvedApplicationsConcerning(out, disease)).toHaveLength(1);
    }
  });

  it("a missing snapshot is chemistry unavailable, not 'no groups'", () => {
    const out = project([
      record({ tanks: [{ chemicals: [{ id: "l1", name: "Legacy product" }] }] }),
    ]);
    expect(out.events[0].products[0].availability).toBe("unavailable");
    expect(out.events[0].products[0].groups.codes).toEqual([]);
  });

  it("a snapshot with display text but no structured group is still unavailable", () => {
    const out = project([
      record({
        tanks: [
          {
            chemicals: [
              {
                id: "l1",
                chemicalSnapshot: { ...snapshot([]), legacy_chemical_group: "Group 3 + 11" },
              },
            ],
          },
        ],
      }),
    ]);
    expect(out.events[0].products[0].availability).toBe("unavailable");
  });

  it("conflict chemistry stays conflict", () => {
    const out = project([
      record({
        tanks: [{ chemicals: [{ id: "l1", chemicalSnapshot: snapshot(["11"], "conflict") }] }],
      }),
    ]);
    expect(out.events[0].products[0].availability).toBe("conflict");
  });

  it("preserves every availability state rather than a trusted/untrusted boolean", () => {
    const states: [string, string][] = [
      ["verified", "available_verified"],
      ["partially_verified", "available_partially_verified"],
      ["unverified", "available_unverified"],
      ["needs_match", "available_unverified"],
      ["conflict", "conflict"],
    ];
    for (const [status, expected] of states) {
      const out = project([
        record({
          tanks: [{ chemicals: [{ id: "l1", chemicalSnapshot: snapshot(["11"], status) }] }],
        }),
      ]);
      expect(out.events[0].products[0].availability, status).toBe(expected);
    }
  });
});

describe("exclusions are reported, not hidden", () => {
  it("templates, deletions and undated records are each surfaced", () => {
    const out = project([
      record({ id: "t", is_template: true }),
      record({ id: "d", deleted_at: "2026-09-02T00:00:00Z" }),
      record({ id: "u", date: null, applied_at: null }),
    ]);
    expect(out.templateRecordIds).toEqual(["t"]);
    expect(out.deletedRecordIds).toEqual(["d"]);
    expect(out.undatedRecordIds).toEqual(["u"]);
    expect(out.events).toHaveLength(0);
  });

  it("classifies a record with no end time as planned rather than dropping it", () => {
    const out = project([record({ end_time: null })]);
    expect(out.events[0].kind).toBe("planned");
  });
});

describe("one spray = one event", () => {
  it("a three-product tank is one application, not three", () => {
    const out = project([
      record({
        tanks: [
          {
            chemicals: [
              { id: "a", chemicalSnapshot: snapshot(["11"]) },
              { id: "b", chemicalSnapshot: snapshot(["3"]) },
              { id: "c", chemicalSnapshot: snapshot(["M3"]) },
            ],
          },
        ],
      }),
    ]);
    expect(out.events).toHaveLength(1);
    expect(out.events[0].products).toHaveLength(3);
  });

  it("one spray across two blocks becomes one event per block sharing the record id", () => {
    const out = project([
      record({ application_blocks: [{ blockId: "block-a" }, { blockId: "block-c" }] }),
    ]);
    expect(out.events).toHaveLength(2);
    expect(new Set(out.events.map((e) => e.applicationId))).toEqual(new Set(["rec-1"]));
  });

  it("duplicated block ids on one record do not double-count", () => {
    const out = project([
      record({ application_blocks: [{ blockId: "block-a" }, { blockId: "block-a" }] }),
    ]);
    expect(out.events).toHaveLength(1);
  });
});

describe("deterministic chronology", () => {
  it("orders by date then application id, independent of row order", () => {
    const rows = [
      record({ id: "zzz", date: "2026-09-10" }),
      record({ id: "aaa", date: "2026-09-10" }),
      record({ id: "mid", date: "2026-09-02" }),
    ];
    const forward = project(rows).events.map((e) => e.applicationId);
    const reverse = project([...rows].reverse()).events.map((e) => e.applicationId);
    expect(forward).toEqual(["mid", "aaa", "zzz"]);
    expect(reverse).toEqual(forward);
  });
});
