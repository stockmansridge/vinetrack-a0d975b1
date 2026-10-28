import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import {
  buildSoilActivityStats,
  loadSoilActivityStats,
  loadSoilActivityParticipants,
  soilActivityWindowStart,
  type SoilActivitySampleRow,
  type SoilActivityDocumentRow,
} from "@/lib/soilPlatformActivity";

// Read-only client mock: captures every filter the loader applies and replays
// the fixture rows, so the metric definitions are checked without a backend.
const readMock = vi.hoisted(() => ({
  samples: [] as Record<string, unknown>[],
  documents: [] as Record<string, unknown>[],
  error: null as { message: string } | null,
  calls: [] as Array<{ table: string; filters: string[]; range: unknown }>,
}));

vi.mock("@/integrations/ios-supabase/client", () => {
  const makeBuilder = (table: string) => {
    const filters: string[] = [];
    // A created_at lower bound behaves like the real server: rows outside it
    // never come back, so the loader's completeness guard is exercised.
    let bound: string | null = null;
    const b: any = { __filters: filters };
    const record = (name: string, args: unknown[]) => {
      // Normalise both filter styles to "column.gte.<iso>" so the loader's
      // window bound is inspectable whichever way it was applied.
      if (name === "or") filters.push(String(args[0]));
      if (name === "gte") {
        filters.push(`${args[0]}.gte.${args[1]}`);
        if (args[0] === "created_at") bound = String(args[1]);
      }
      if (name === "range") readMock.calls.push({ table, filters, range: args });
      return b;
    };
    for (const m of [
      "select",
      "eq",
      "gte",
      "is",
      "in",
      "or",
      "order",
      "limit",
      "range",
      "abortSignal",
    ]) {
      b[m] = (...args: unknown[]) => record(m, args);
    }
    b.then = (resolve: (value: unknown) => void) => {
      const all =
        table === "soil_samples"
          ? readMock.samples
          : table === "soil_sample_documents"
            ? readMock.documents
            : [];
      const data = bound
        ? all.filter((r) => new Date(String(r.created_at)).getTime() >= new Date(bound!).getTime())
        : all;
      resolve({ data, error: readMock.error });
    };
    return b;
  };
  return {
    supabase: { from: (table: string) => makeBuilder(table) },
    iosSupabase: { from: (table: string) => makeBuilder(table) },
  };
});


const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const SAMPLES: SoilActivitySampleRow[] = [
  {
    id: "a",
    vineyard_id: "v1",
    created_by: "u1",
    created_at: hoursAgo(2),
    updated_at: hoursAgo(2),
    deleted_at: null,
  },
  {
    id: "b",
    vineyard_id: "v1",
    created_by: "u1",
    created_at: hoursAgo(240),
    updated_at: hoursAgo(2),
    deleted_at: null,
  },
  {
    id: "c",
    vineyard_id: "v2",
    created_by: "u2",
    created_at: hoursAgo(2),
    updated_at: hoursAgo(1),
    deleted_at: hoursAgo(1),
  },
  {
    id: "d",
    vineyard_id: "v3",
    created_by: "u3",
    created_at: hoursAgo(9600),
    updated_at: hoursAgo(7200),
    deleted_at: null,
  },
];

const DOCUMENTS: SoilActivityDocumentRow[] = [
  { id: "d1", vineyard_id: "v1", uploaded_by: "u1", created_at: hoursAgo(2) },
  { id: "d2", vineyard_id: "v2", uploaded_by: "u2", created_at: hoursAgo(240) },
  { id: "d3", vineyard_id: "v3", uploaded_by: "u3", created_at: hoursAgo(9600) },
];

function row(stats: ReturnType<typeof buildSoilActivityStats>, key: string) {
  const r = stats.find((s) => s.action_key === key);
  if (!r) throw new Error(`missing activity row ${key}`);
  return r;
}

describe("soilActivityWindowStart", () => {
  it("is null for all time and N days back for a period", () => {
    expect(soilActivityWindowStart(null)).toBeNull();
    const seven = soilActivityWindowStart(7);
    expect(seven).not.toBeNull();
    const diffDays = (Date.now() - new Date(seven as string).getTime()) / 86_400_000;
    expect(diffDays).toBeGreaterThan(6.9);
    expect(diffDays).toBeLessThan(7.1);
  });
});

describe("buildSoilActivityStats", () => {
  it("counts added, edited and deleted soil samples inside a 1-day period", () => {
    const r = row(buildSoilActivityStats(SAMPLES, DOCUMENTS, 1), "soil_samples");
    expect(r.label).toBe("Soil Sample");
    expect(r.category).toBe("Soil Analysis");
    // a created 2h ago, c created 2h ago (and deleted 1h ago).
    expect(r.created_count).toBe(2);
    // b edited 2h ago, c edited 1h ago; a is unchanged since creation.
    expect(r.edited_count).toBe(2);
    expect(r.deleted_count).toBe(1);
    // Attribution follows records ADDED in the period only (a=v1/u1, c=v2/u2).
    expect(r.vineyard_count).toBe(2);
    expect(r.user_count).toBe(2);
    // Lists come from this module's own read, not the SQL 257 participant RPC.
    expect(r.participant_source).toBe("soil");
  });

  it("excludes records outside a 90-day period but keeps older edits out of it", () => {
    const r = row(buildSoilActivityStats(SAMPLES, DOCUMENTS, 90), "soil_samples");
    expect(r.created_count).toBe(3); // a, b, c — d is 400 days old
    expect(r.edited_count).toBe(2); // b, c — d's edit is 300 days old
    expect(r.deleted_count).toBe(1);
    expect(r.vineyard_count).toBe(2); // v1, v2
    expect(r.user_count).toBe(2); // u1, u2
  });

  it("includes every record for all time", () => {
    const r = row(buildSoilActivityStats(SAMPLES, DOCUMENTS, null), "soil_samples");
    expect(r.created_count).toBe(4);
    expect(r.edited_count).toBe(3); // b, c and d
    expect(r.deleted_count).toBe(1);
    expect(r.vineyard_count).toBe(3);
    expect(r.user_count).toBe(3);
  });

  it("reports lab documents as added-only evidence with no edited or deleted figures", () => {
    const r = row(buildSoilActivityStats(SAMPLES, DOCUMENTS, 1), "soil_sample_documents");
    expect(r.label).toBe("Soil Lab Document");
    expect(r.created_count).toBe(1);
    expect(r.edited_count).toBeNull();
    expect(r.deleted_count).toBeNull();
    expect(r.vineyard_count).toBe(1);
    expect(r.user_count).toBe(1);
    expect(r.participant_source).toBe("soil");

    const all = row(buildSoilActivityStats(SAMPLES, DOCUMENTS, null), "soil_sample_documents");
    expect(all.created_count).toBe(3);
    expect(all.vineyard_count).toBe(3);
    expect(all.user_count).toBe(3);
  });

  it("shows zero counts, not blanks, when nothing happened in the period", () => {
    const r = row(buildSoilActivityStats(SAMPLES, DOCUMENTS, null), "soil_samples");
    const empty = row(buildSoilActivityStats([], [], null), "soil_samples");
    expect(r.created_count).toBe(4);
    expect(empty.created_count).toBe(0);
    expect(empty.edited_count).toBe(0);
    expect(empty.deleted_count).toBe(0);
    expect(empty.vineyard_count).toBe(0);
    expect(empty.user_count).toBe(0);
  });
});

describe("loadSoilActivityStats", () => {
  beforeEach(() => {
    readMock.samples = SAMPLES as unknown as Record<string, unknown>[];
    readMock.documents = DOCUMENTS as unknown as Record<string, unknown>[];
    readMock.error = null;
    readMock.calls = [];
  });

  afterEach(cleanup);

  it("applies the selected period to both soil reads", async () => {
    const stats = await loadSoilActivityStats(7);
    expect(stats.map((s) => s.action_key)).toEqual([
      "soil_samples",
      "soil_sample_documents",
    ]);
    const cutoff = new Date(soilActivityWindowStart(7) as string).getTime();
    const sampleCall = readMock.calls.find((c) => c.table === "soil_samples");
    const documentCall = readMock.calls.find((c) => c.table === "soil_sample_documents");
    const sampleFilter = sampleCall?.filters[0] ?? "";
    // One window bound per lifecycle column, all the same instant.
    const bounds = sampleFilter.split(",");
    expect(bounds.length).toBe(3);
    for (const [i, column] of ["created_at", "updated_at", "deleted_at"].entries()) {
      expect(bounds[i]).toMatch(new RegExp(`^${column}\\.gte\\.\\d{4}-`));
      const captured = new Date(bounds[i].replace(`${column}.gte.`, "")).getTime();
      expect(Math.abs(captured - cutoff)).toBeLessThan(2000);
    }
    expect(documentCall?.filters.length).toBe(1);
    expect(documentCall?.filters[0]).toMatch(/^created_at\.gte\.\d{4}-/);
    const docCutoff = new Date(documentCall!.filters[0].replace("created_at.gte.", "")).getTime();
    expect(Math.abs(docCutoff - cutoff)).toBeLessThan(2000);
  });

  it("reads every record for all time without a date filter", async () => {
    await loadSoilActivityStats(null);
    const sampleCall = readMock.calls.find((c) => c.table === "soil_samples");
    const documentCall = readMock.calls.find((c) => c.table === "soil_sample_documents");
    expect(sampleCall?.filters).toEqual([]);
    expect(documentCall?.filters).toEqual([]);
  });

  it("fails closed instead of reporting a zero when the read is refused", async () => {
    readMock.error = { message: "permission denied" };
    await expect(loadSoilActivityStats(30)).rejects.toThrow(/permission denied/);
  });
});

describe("loadSoilActivityParticipants", () => {
  beforeEach(() => {
    readMock.samples = SAMPLES as unknown as Record<string, unknown>[];
    readMock.documents = DOCUMENTS as unknown as Record<string, unknown>[];
    readMock.error = null;
    readMock.calls = [];
  });

  afterEach(cleanup);

  it("groups soil samples by the recorded creator, busiest first", async () => {
    const rows = await loadSoilActivityParticipants("soil_samples", "users", null);
    // u1 added a and b; u2 added c; u3 added d — ties break on the id.
    expect(rows).toEqual([
      { id: "u1", records: 2 },
      { id: "u2", records: 1 },
      { id: "u3", records: 1 },
    ]);
  });

  it("groups soil samples by vineyard for the vineyard count", async () => {
    const rows = await loadSoilActivityParticipants("soil_samples", "vineyards", null);
    expect(rows).toEqual([
      { id: "v1", records: 2 },
      { id: "v2", records: 1 },
      { id: "v3", records: 1 },
    ]);
  });

  it("attributes lab documents to whoever uploaded them", async () => {
    const users = await loadSoilActivityParticipants("soil_sample_documents", "users", null);
    expect(users).toEqual([
      { id: "u1", records: 1 },
      { id: "u2", records: 1 },
      { id: "u3", records: 1 },
    ]);
    const vineyards = await loadSoilActivityParticipants(
      "soil_sample_documents",
      "vineyards",
      null,
    );
    expect(vineyards.map((r) => r.id)).toEqual(["v1", "v2", "v3"]);
  });

  it("lists only participants who added records inside the selected period", async () => {
    const rows = await loadSoilActivityParticipants("soil_samples", "users", 1);
    // a (u1) and c (u2) were added in the last day; b and d were not.
    expect(rows).toEqual([
      { id: "u1", records: 1 },
      { id: "u2", records: 1 },
    ]);
    const cutoff = new Date(soilActivityWindowStart(1) as string).getTime();
    const call = readMock.calls.find((c) => c.table === "soil_samples");
    expect(call?.filters.length).toBe(1);
    const captured = new Date(call!.filters[0].replace("created_at.gte.", "")).getTime();
    expect(Math.abs(captured - cutoff)).toBeLessThan(2000);
  });

  it("fails closed rather than showing a short list", async () => {
    readMock.error = { message: "permission denied" };
    await expect(loadSoilActivityParticipants("soil_samples", "users", 7)).rejects.toThrow(
      /permission denied/,
    );
  });
});
