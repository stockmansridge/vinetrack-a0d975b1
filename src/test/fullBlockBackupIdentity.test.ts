import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { from: () => ({}) } }));
import {
  applyImportAsNew, applyImportPlan, buildFullBlockBackup, buildImportPlan,
  parseFullBlockBackup, DEFAULT_IMPORT_OPTIONS, CROSS_VINEYARD_ROW_IDENTITY_MESSAGE, type FullBlock,
} from "@/lib/paddockFullBlockBackup";

const pt = (id: string, lat: number, lng: number) => ({ id, latitude: lat, longitude: lng });
const row = (n: number, id: string) => ({ id, number: n, startPoint: pt(`${id}-s`, -34 - n / 1e4, 138), endPoint: pt(`${id}-e`, -34 - n / 1e4, 138.001) });
const sourceBlock: FullBlock = {
  id: "src-block", vineyard_id: "vy-A", name: "Block 1",
  polygon_points: [pt("pp1", -34, 138), pt("pp2", -34, 138.01), pt("pp3", -34.01, 138.01)],
  rows: [row(1, "row-A"), row(2, "row-B")], vine_spacing: 1.5,
};

function fakeClient() {
  const calls: { op: string; payload: any; filters: [string, any][] }[] = [];
  const client = {
    from: (table: string) => {
      expect(table).toBe("paddocks");
      return {
        insert: async (payload: any) => { calls.push({ op: "insert", payload, filters: [] }); return { error: null }; },
        update: (payload: any) => {
          const c = { op: "update", payload, filters: [] as [string, any][] };
          calls.push(c);
          const chain: any = { eq: (k: string, v: any) => { c.filters.push([k, v]); return chain; }, then: (r: any) => r({ error: null }) };
          return chain;
        },
      };
    },
  };
  return { client, calls };
}
const ids = (b: any) => [
  ...b.rows.flatMap((r: any) => [r.id, r.startPoint.id, r.endPoint.id]),
  ...b.polygon_points.map((p: any) => p.id),
];
const srcIds = ids(sourceBlock);

async function exportImportNew(target: string) {
  const backup = parseFullBlockBackup(buildFullBlockBackup([sourceBlock], { id: "vy-A", name: "A" }));
  const { client, calls } = fakeClient();
  const res = await applyImportAsNew(backup.blocks, target, client);
  return { res, inserted: calls[0].payload, calls };
}

describe("Full Block import identity safety", () => {
  it("A → B import as new: same rows/geometry, all new ids, no shared row UUIDs", async () => {
    const { res, inserted } = await exportImportNew("vy-B");
    expect(inserted.vineyard_id).toBe("vy-B");
    expect(inserted.id).toBeUndefined();
    expect(inserted.rows.map((r: any) => r.number)).toEqual([1, 2]);
    inserted.rows.forEach((r: any, i: number) => {
      const s = (sourceBlock.rows as any[])[i];
      expect([r.startPoint.latitude, r.startPoint.longitude, r.endPoint.latitude, r.endPoint.longitude])
        .toEqual([s.startPoint.latitude, s.startPoint.longitude, s.endPoint.latitude, s.endPoint.longitude]);
      expect(r.id).not.toBe(s.id);
      expect(r.startPoint.id).not.toBe(s.startPoint.id);
      expect(r.endPoint.id).not.toBe(s.endPoint.id);
    });
    inserted.polygon_points.forEach((p: any, i: number) => {
      expect(p.id).not.toBe((sourceBlock.polygon_points as any[])[i].id);
      expect(p.latitude).toBe((sourceBlock.polygon_points as any[])[i].latitude);
    });
    const shared = ids(inserted).filter((id) => srcIds.includes(id));
    expect(shared).toEqual([]);
    expect(new Set(ids(inserted)).size).toBe(ids(inserted).length);
    expect(res).toMatchObject({ rowsCopied: 2, rowIdsCreated: 2, blocksCreated: 1 });
  });

  it("import as new into the same vineyard also creates new ids", async () => {
    const { inserted } = await exportImportNew("vy-A");
    expect(ids(inserted).filter((id) => srcIds.includes(id))).toEqual([]);
  });

  it("existing-block restore keeps destination ids, maps by row number, new row gets new id", async () => {
    const target: FullBlock = {
      id: "tgt-block", vineyard_id: "vy-B", name: "block 1",
      polygon_points: [pt("tp1", 0, 0), pt("tp2", 0, 0), pt("tp3", 0, 0)],
      // target stored in different order, row 2 missing
      rows: [row(1, "row-X")],
    };
    const opts = { ...DEFAULT_IMPORT_OPTIONS, overwrite: { boundary: true, rows: true, setup: true, varieties: true } };
    const plan = buildImportPlan([sourceBlock], [target], opts);
    const { client, calls } = fakeClient();
    const res = await applyImportPlan(plan, "vy-B", [target], client);
    const patch = calls[0].payload;
    expect(calls[0].filters).toEqual([["id", "tgt-block"], ["vineyard_id", "vy-B"]]);
    expect(patch.id).toBeUndefined();
    expect(patch.vineyard_id).toBeUndefined();
    const r1 = patch.rows.find((r: any) => r.number === 1);
    expect(r1.id).toBe("row-X");
    expect(r1.startPoint.id).toBe("row-X-s");
    expect(r1.startPoint.latitude).toBe((sourceBlock.rows as any[])[0].startPoint.latitude);
    const r2 = patch.rows.find((r: any) => r.number === 2);
    expect(r2.id).not.toBe("row-B");
    expect(r2.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(patch.polygon_points.map((p: any) => p.id)).toEqual(["tp1", "tp2", "tp3"]);
    expect(ids(patch).filter((id) => srcIds.includes(id))).toEqual([]);
    expect(res).toMatchObject({ rowIdsPreserved: 1, rowIdsCreated: 1 });
  });

  it("v1 backup files (with source UUIDs) still import", async () => {
    const v1 = JSON.stringify({ format: "vinetrack.full-block-backup", version: 1, exported_at: "2025-01-01", vineyard: { id: "vy-A", name: "A" }, blocks: [sourceBlock] });
    const parsed = parseFullBlockBackup(v1);
    const { client, calls } = fakeClient();
    const res = await applyImportAsNew(parsed.blocks, "vy-B", client);
    expect(res.errors).toEqual([]);
    expect(ids(calls[0].payload).filter((id) => srcIds.includes(id))).toEqual([]);
  });

  it("writes only to paddocks — no operational records", async () => {
    const tables: string[] = [];
    const client = { from: (t: string) => { tables.push(t); return { insert: async () => ({ error: null }) }; } };
    await applyImportAsNew([sourceBlock], "vy-B", client);
    expect(tables).toEqual(["paddocks"]);
  });

  it("cross_vineyard_row_identity errors get the friendly message", async () => {
    const client = { from: () => ({ insert: async () => ({ error: { message: 'violates check: cross_vineyard_row_identity row 123' } }) }) };
    const res = await applyImportAsNew([sourceBlock], "vy-B", client);
    expect(res.errors[0]).toContain(CROSS_VINEYARD_ROW_IDENTITY_MESSAGE);
    expect(res.errors[0]).not.toContain("cross_vineyard_row_identity");
  });
});
