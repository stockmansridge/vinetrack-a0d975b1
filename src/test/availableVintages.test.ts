import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the iOS Supabase client used by the source reader.
const rows: Record<string, any[]> = {};
let lastFilters: Record<string, any> = {};

vi.mock("@/integrations/ios-supabase/client", () => {
  const makeQuery = (table: string) => {
    const filters: Record<string, any> = {};
    const q: any = {
      select: (_c: string) => q,
      eq: (c: string, v: any) => {
        filters[c] = v;
        return q;
      },
      is: (c: string, v: any) => {
        filters[`is:${c}`] = v;
        return q;
      },
      then: (resolve: any) => {
        lastFilters = filters;
        const data = (rows[table] ?? []).filter((r) => {
          for (const [k, v] of Object.entries(filters)) {
            if (k.startsWith("is:")) {
              if (r[k.slice(3)] != null) return false;
            } else if (r[k] !== v) return false;
          }
          return true;
        });
        return Promise.resolve(resolve({ data, error: null }));
      },
    };
    return q;
  };
  return { supabase: { from: (table: string) => makeQuery(table) } };
});

import {
  fetchAvailableVintages,
  vintageForISO,
  vintagesFromDates,
} from "@/lib/availableVintages";

// Southern-hemisphere style season: 1 July → 30 June.
const MONTH = 7;
const DAY = 1;
const SOURCE = { table: "pins", dateColumn: "created_at" } as const;

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  lastFilters = {};
});

describe("vintage attribution", () => {
  it("attributes dates to the canonical season, not the calendar year", () => {
    expect(vintageForISO("2024-07-01", MONTH, DAY)).toBe(2025);
    expect(vintageForISO("2024-06-30", MONTH, DAY)).toBe(2024);
    expect(vintageForISO(null, MONTH, DAY)).toBeNull();
  });

  it("returns unique Vintages newest first", () => {
    expect(
      vintagesFromDates(["2024-07-02", "2025-01-01", "2023-08-01", null], MONTH, DAY),
    ).toEqual([2025, 2024]);
  });
});

describe("fetchAvailableVintages", () => {
  it("returns only Vintages that contain records (two populated Vintages)", async () => {
    rows.pins = [
      { created_at: "2024-08-01", vineyard_id: "v1", deleted_at: null },
      { created_at: "2023-08-01", vineyard_id: "v1", deleted_at: null },
    ];
    expect(await fetchAvailableVintages([SOURCE], "v1", MONTH, DAY)).toEqual([2025, 2024]);
  });

  it("returns nothing when the vineyard has no records", async () => {
    rows.pins = [];
    expect(await fetchAvailableVintages([SOURCE], "v1", MONTH, DAY)).toEqual([]);
  });

  it("omits the current Vintage when it has no records", async () => {
    rows.pins = [{ created_at: "2020-08-01", vineyard_id: "v1", deleted_at: null }];
    const out = await fetchAvailableVintages([SOURCE], "v1", MONTH, DAY);
    expect(out).toEqual([2021]);
    expect(out).not.toContain(new Date().getUTCFullYear() + 1);
  });

  it("ignores soft-deleted records", async () => {
    rows.pins = [
      { created_at: "2024-08-01", vineyard_id: "v1", deleted_at: "2024-09-01" },
      { created_at: "2023-08-01", vineyard_id: "v1", deleted_at: null },
    ];
    expect(await fetchAvailableVintages([SOURCE], "v1", MONTH, DAY)).toEqual([2024]);
  });

  it("isolates vineyards", async () => {
    rows.pins = [
      { created_at: "2024-08-01", vineyard_id: "v2", deleted_at: null },
      { created_at: "2023-08-01", vineyard_id: "v1", deleted_at: null },
    ];
    expect(await fetchAvailableVintages([SOURCE], "v1", MONTH, DAY)).toEqual([2024]);
    expect(lastFilters.vineyard_id).toBe("v1");
  });

  it("unions table and custom (RPC-backed) sources for combined dashboards", async () => {
    rows.pins = [{ created_at: "2024-08-01", vineyard_id: "v1", deleted_at: null }];
    const custom = { key: "irrigation_sessions", loadVintages: async () => [2022] };
    expect(await fetchAvailableVintages([SOURCE, custom], "v1", MONTH, DAY)).toEqual([
      2025, 2022,
    ]);
  });
});
