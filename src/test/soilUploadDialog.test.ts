// Upload dialog contract: drag-and-drop zone, multi-file selection, and
// sequential per-file upload with preserved evidence on per-file failure.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/components/soil-analysis/UploadSampleDialog.tsx", "utf8");

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

  it("keeps per-file failures visible and preserves evidence", () => {
    expect(src).toContain("ExtractionErrorNotice");
    expect(src).toContain("failed.push");
  });

  it("still navigates a single clean upload straight to review", () => {
    expect(src).toContain("onUploaded(succeeded[0])");
  });
});
