import { describe, it, vi } from "vitest";
import tracked from "../../docs/fixtures/spray-report-v1-2-tracked.json";
import { parseSprayReportPayload } from "@/lib/sprayReportV1";
import { buildSprayReportPdf } from "@/lib/sprayReportPdf";
import { writeFileSync } from "node:fs";
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: vi.fn(), storage: { from: vi.fn() }, from: vi.fn() } }));
describe("overflow", () => {
  it("long hand drawn warnings", () => {
    const raw: any = JSON.parse(JSON.stringify(tracked));
    raw.warnings = Array.from({ length: 90 }, (_, i) => `Warning number ${i + 1}: something incomplete was detected in this application record and should be reviewed.`);
    const { payload, errors } = parseSprayReportPayload(raw);
    console.log("ERR", errors.slice(0,3));
    const doc = buildSprayReportPdf(payload!, {});
    console.log("PAGES", (doc as any).internal.getNumberOfPages());
    writeFileSync("/tmp/pdfchk/ovf.pdf", Buffer.from(doc.output("arraybuffer") as ArrayBuffer));
  });
});
