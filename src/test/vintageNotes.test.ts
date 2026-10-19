import { describe, expect, it } from "vitest";
import {
  ALL_NOTE_TYPES,
  buildVintageNoteInsert,
  filterVintageNotes,
  groupNoteTypes,
  noteTypeGroupLabel,
  sameVintageNotePayload,
  validateVintageNote,
  type VintageNote,
  type VintageNoteType,
} from "@/lib/vintageNotes";
import { vintageScope } from "@/lib/vintageScope";

const type = (over: Partial<VintageNoteType> = {}): VintageNoteType => ({
  id: "t1",
  vineyard_id: null,
  code: "rain",
  group_code: "weather",
  label: "Rainfall",
  sort_order: 1,
  is_system: true,
  is_active: true,
  deleted_at: null,
  ...over,
});

const note = (over: Partial<VintageNote> = {}): VintageNote => ({
  id: "n1",
  vineyard_id: "vy1",
  note_date: "2026-02-10",
  vintage_year: 2026,
  note_type_id: "t1",
  note_type_label: "Rainfall",
  notes: "25 mm overnight",
  observed_by_user_id: "u1",
  observer_name_snapshot: "Jane",
  created_at: "2026-02-10T08:00:00Z",
  updated_at: "2026-02-10T08:00:00Z",
  deleted_at: null,
  ...over,
});

describe("validateVintageNote", () => {
  it("accepts type-only, text-only and both", () => {
    expect(validateVintageNote({ noteDate: "2026-02-10", noteTypeId: "t1", notes: "" }).ok).toBe(true);
    expect(validateVintageNote({ noteDate: "2026-02-10", noteTypeId: null, notes: "hello" }).ok).toBe(true);
    expect(validateVintageNote({ noteDate: "2026-02-10", noteTypeId: "t1", notes: "hello" }).ok).toBe(true);
  });

  it("rejects only when both type and text are empty", () => {
    const r = validateVintageNote({ noteDate: "2026-02-10", noteTypeId: null, notes: "   " });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/at least one/i);
  });

  it("requires a date", () => {
    expect(validateVintageNote({ noteDate: "", noteTypeId: "t1", notes: "x" }).ok).toBe(false);
  });
});

describe("buildVintageNoteInsert", () => {
  const base = {
    vineyardId: "vy1",
    draft: { noteDate: "2026-02-10", noteTypeId: "t1", notes: "  25 mm  " },
    observerUserId: "u1",
    observerName: "Jane",
    noteType: type(),
    clientId: "11111111-1111-4111-8111-111111111111",
  };

  it("never sends vintage_year — the server trigger computes it", () => {
    const payload = buildVintageNoteInsert(base);
    expect(payload).not.toHaveProperty("vintage_year");
  });

  it("snapshots the type label and trims text", () => {
    const payload = buildVintageNoteInsert(base);
    expect(payload.note_type_label).toBe("Rainfall");
    expect(payload.notes).toBe("25 mm");
    expect(payload.id).toBe(base.clientId);
    expect(payload.observed_by_user_id).toBe("u1");
    expect(payload.observer_name_snapshot).toBe("Jane");
  });

  it("stores null type and null text when absent", () => {
    const payload = buildVintageNoteInsert({
      ...base,
      draft: { noteDate: "2026-02-10", noteTypeId: null, notes: "" },
      noteType: null,
    });
    expect(payload.note_type_id).toBeNull();
    expect(payload.note_type_label).toBeNull();
    expect(payload.notes).toBeNull();
  });
});

describe("groupNoteTypes", () => {
  it("orders groups by the contract order and types by sort_order", () => {
    const groups = groupNoteTypes([
      type({ id: "a", group_code: "other", label: "General", sort_order: 1 }),
      type({ id: "b", group_code: "weather", label: "Frost", sort_order: 2 }),
      type({ id: "c", group_code: "weather", label: "Rainfall", sort_order: 1 }),
      type({ id: "d", group_code: "disease", label: "Powdery mildew", sort_order: 1 }),
    ]);
    expect(groups.map((g) => g.groupCode)).toEqual(["weather", "disease", "other"]);
    expect(groups[0].types.map((t) => t.label)).toEqual(["Rainfall", "Frost"]);
  });

  it("excludes retired and deleted types", () => {
    const groups = groupNoteTypes([
      type({ id: "a", is_active: false }),
      type({ id: "b", deleted_at: "2026-01-01" }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("labels known groups and falls back to Other", () => {
    expect(noteTypeGroupLabel("phenology")).toBe("Phenology");
    expect(noteTypeGroupLabel("something-new")).toBe("Other");
  });
});

describe("filterVintageNotes", () => {
  const scope2026 = vintageScope(2026, 7, 1);

  it("scopes by note_date within the season window", () => {
    const inN = note({ id: "in", note_date: "2026-02-10" });
    const outN = note({ id: "out", note_date: "2026-09-01" });
    expect(
      filterVintageNotes([inN, outN], { scope: scope2026, typeId: ALL_NOTE_TYPES, search: "" }),
    ).toEqual([inN]);
  });

  it("filters by type id and searches text/observer", () => {
    const a = note({ id: "a", note_type_id: "t1", notes: "frost risk", observer_name_snapshot: "Jane" });
    const b = note({ id: "b", note_type_id: "t2", notes: "irrigated", observer_name_snapshot: "Tom" });
    expect(filterVintageNotes([a, b], { scope: null, typeId: "t2", search: "" })).toEqual([b]);
    expect(filterVintageNotes([a, b], { scope: null, typeId: ALL_NOTE_TYPES, search: "frost" })).toEqual([a]);
    expect(filterVintageNotes([a, b], { scope: null, typeId: ALL_NOTE_TYPES, search: "tom" })).toEqual([b]);
  });
});
