// Regression: a text-heavy Spray Report must keep every page in the SERIALIZED
// artifact that Download Spray Report hands to the browser. Long hand-drawn
// paragraphs previously overflowed off page 1 without adding pages, so a report
// that should span several pages downloaded as a single page.
import { describe, it, expect, vi } from "vitest";
import tracked from "../../docs/fixtures/spray-report-v1-2-tracked.json";
import { parseSprayReportPayload } from "@/lib/sprayReportV1";
import { buildSprayReportPdf } from "@/lib/sprayReportPdf";

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { rpc: vi.fn(), storage: { from: vi.fn() }, from: vi.fn() },
}));

function serializedPageCount(bytes: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(bytes);
  const match = /\/Type \/Pages[\s\S]{0,600}?\/Count (\d+)/.exec(text);
  expect(match).not.toBeNull();
  return Number(match![1]);
}

describe("Spray Report PDF pagination survives serialization", () => {
  it("keeps every page of a long text-heavy report", () => {
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(tracked));
    raw.warnings = Array.from(
      { length: 120 },
      (_, i) =>
        `Warning ${i + 1}: an incomplete value was detected in this application record and should be reviewed before compliance submission.`,
    );
    const { payload, errors } = parseSprayReportPayload(raw);
    expect(errors).toEqual([]);

    const doc = buildSprayReportPdf(payload!, {});
    const inMemoryPages = (doc as unknown as {
      internal: { getNumberOfPages: () => number };
    }).internal.getNumberOfPages();
    expect(inMemoryPages).toBeGreaterThanOrEqual(3);

    const bytes = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
    expect(serializedPageCount(bytes)).toBe(inMemoryPages);
  });

  it("still produces a single page for a short report", () => {
    const { payload } = parseSprayReportPayload(JSON.parse(JSON.stringify(tracked)));
    const doc = buildSprayReportPdf(payload!, {});
    const bytes = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
    expect(serializedPageCount(bytes)).toBe(
      (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages(),
    );
  });
});
