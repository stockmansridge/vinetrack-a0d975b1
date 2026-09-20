import { describe, it, vi } from "vitest";
import tracked from "../../docs/fixtures/spray-report-v1-2-tracked.json";
import manual from "../../docs/fixtures/spray-report-v1-2-manual.json";
import { parseSprayReportPayload } from "@/lib/sprayReportV1";
import { buildSprayReportPdf } from "@/lib/sprayReportPdf";
import { writeFileSync } from "node:fs";
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: vi.fn(), storage: { from: vi.fn() }, from: vi.fn() } }));
describe("manual multipage", () => {
  it("writes", () => {
    const raw: any = JSON.parse(JSON.stringify(manual));
    const t: any = tracked;
    raw.rows = Array.from({ length: 140 }, (_, i) => ({ ...t.rows[0], rowNumber: i + 1 }));
    const { payload, errors } = parseSprayReportPayload(raw);
    console.log("ERRORS", errors.slice(0, 5));
    const doc = buildSprayReportPdf(payload!, {});
    console.log("PAGES", (doc as any).internal.getNumberOfPages());
    writeFileSync("/tmp/pdfchk/manual.pdf", Buffer.from(doc.output("arraybuffer") as ArrayBuffer));
  });
});
