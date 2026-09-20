import { describe, it, expect, vi } from "vitest";
import fixture from "../../docs/fixtures/spray-report-v1-2-manual.json";
import { parseSprayReportPayload } from "@/lib/sprayReportV1";
import { buildSprayReportPdf } from "@/lib/sprayReportPdf";
import { writeFileSync } from "node:fs";
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: vi.fn(), storage: { from: vi.fn() }, from: vi.fn() } }));
describe("multipage", () => {
  it("serializes all pages", () => {
    const raw: any = JSON.parse(JSON.stringify(fixture));
    raw.rows = Array.from({ length: 140 }, (_, i) => ({ ...raw.rows[0], rowNumber: i + 1 }));
    const { payload, errors } = parseSprayReportPayload(raw);
    expect(errors).toEqual([]);
    const doc = buildSprayReportPdf(payload!, {});
    const before = (doc as any).internal.getNumberOfPages();
    const buf = Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
    writeFileSync("/tmp/pdfchk/out.pdf", buf);
    console.log("PAGES_BEFORE", before, "BYTES", buf.length);
    expect(before).toBeGreaterThanOrEqual(3);
  });
});
