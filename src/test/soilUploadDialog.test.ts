// Upload dialog contract: drag-and-drop zone, multi-file selection, and
// independent per-file processing with clear per-file outcomes. A failed
// file never stops later files, never fails the batch as a whole, and stays
// retryable from Samples without re-uploading the evidence document.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/components/soil-analysis/UploadSampleDialog.tsx", "utf8");
const lib = readFileSync("src/lib/soilAnalysis.ts", "utf8");
const retryFn = lib.slice(
  lib.indexOf("export async function retrySoilExtraction"),
  lib.indexOf("/** Signed short-lived URL"),
);

describe("Soil Analysis upload dialog", () => {
  it("offers a drag-and-drop zone instead of a bare file input", () => {
    expect(src).toContain("onDrop={onDrop}");
    expect(src).toContain("onDragOver");
    expect(src).toContain("Drop reports here, or click to choose files");
  });

  it("accepts multiple files and uploads them one at a time", () => {
    expect(src).toContain("multiple");
    expect(src).toMatch(/for \(const file of files\)/);
  });

  it("a failed item does not prevent later items being attempted", () => {
    // The per-file try/catch lives INSIDE the loop, so a throw continues to
    // the next file instead of aborting the batch.
    const loopStart = src.indexOf("for (const file of files)");
    const loopBody = src.slice(loopStart);
    expect(loopBody.indexOf("try {")).toBeLessThan(loopBody.indexOf("uploadSoilSample"));
    expect(loopBody).toContain("catch (e)");
    expect(loopBody.indexOf("catch (e)")).toBeLessThan(loopBody.indexOf("qc.invalidateQueries"));
  });

  it("reports mixed batches per file, never as a batch failure", () => {
    expect(src).toContain("ready for review · ${failedCount} failed");
    expect(src).toContain("Extracted — Review required");
    expect(src).toContain("Extraction failed — Retry available");
  });

  it("closes with a concise counted toast when every file succeeds", () => {
    expect(src).toContain("reports ready for review");
    expect(src).toContain("onOpenChange(false)");
  });

  it("failed rows stay retryable and successful rows reviewable", () => {
    // Failures are preserved records shown via the shared concise notice;
    // the single clean upload still navigates straight to review.
    expect(src).toContain("ExtractionErrorNotice");
    expect(src).toContain("onUploaded(succeeded[0])");
  });

  it("Retry never re-uploads the document or creates duplicate rows", () => {
    expect(retryFn).not.toContain("storage");
    expect(retryFn).not.toContain(".insert(");
    expect(retryFn).toContain('update({ extraction_status: "pending" })');
    expect(retryFn).toContain("sample_id: sampleId");
    expect(retryFn).toContain("document_id: documentId");
  });
});
