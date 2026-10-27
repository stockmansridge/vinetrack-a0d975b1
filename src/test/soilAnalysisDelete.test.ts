// Hard delete contract: unapproved samples only, storage removed before the
// database row, confirmed samples protected in UI and in the delete path.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  isSoilSampleDeletable,
  CONFIRMED_DELETE_MESSAGE,
} from "@/lib/soilAnalysis";

const lib = readFileSync("src/lib/soilAnalysis.ts", "utf8");
const detail = readFileSync("src/pages/admin/SoilSampleDetailPage.tsx", "utf8");
const list = readFileSync("src/components/soil-analysis/SamplesTab.tsx", "utf8");
const dialog = readFileSync("src/components/soil-analysis/DeleteSampleDialog.tsx", "utf8");

// The deleteSoilSample function body only (up to the Reports section).
const deleteFn = lib.slice(lib.indexOf("export async function deleteSoilSample"));

describe("deletable statuses", () => {
  it("pending, processing, review_required and failed are deletable", () => {
    for (const s of ["pending", "processing", "review_required", "failed"] as const) {
      expect(isSoilSampleDeletable(s)).toBe(true);
    }
  });
  it("confirmed is never deletable", () => {
    expect(isSoilSampleDeletable("confirmed")).toBe(false);
  });
  it("the protected message is exact", () => {
    expect(CONFIRMED_DELETE_MESSAGE).toBe("Confirmed soil samples cannot be deleted.");
  });
});

describe("delete sequence", () => {
  it("removes storage objects before deleting the database row", () => {
    expect(deleteFn.indexOf(".storage.from(bucket).remove(paths)")).toBeGreaterThan(-1);
    expect(deleteFn.indexOf(".storage.from(bucket).remove(paths)")).toBeLessThan(
      deleteFn.indexOf('.from("soil_samples")'),
    );
  });
  it("stops when storage removal fails — the database delete is never reached", () => {
    const storageIdx = deleteFn.indexOf(".storage.from(bucket).remove(paths)");
    const stopIdx = deleteFn.indexOf("Could not remove the uploaded source document");
    const dbIdx = deleteFn.indexOf('.from("soil_samples")');
    expect(storageIdx).toBeLessThan(stopIdx);
    expect(stopIdx).toBeLessThan(dbIdx);
  });
  it("guards the row delete against confirmed and treats no-row as protected", () => {
    expect(deleteFn).toContain('.neq("extraction_status", "confirmed")');
    expect(deleteFn).toContain("deleted.length === 0");
  });
  it("is a hard delete — never a soft-delete flag", () => {
    expect(deleteFn).toContain(".delete()");
    expect(deleteFn).not.toContain("deleted_at");
  });
  it("uses the document's own bucket with the default bucket fallback", () => {
    expect(deleteFn).toContain("doc.storage_bucket || SOIL_DOCUMENT_BUCKET");
  });
});

describe("UI exposure", () => {
  it("detail page gates the destructive action on deletability", () => {
    expect(detail).toContain("isSoilSampleDeletable(sample.extraction_status)");
    expect(detail).toContain("Delete sample permanently");
  });
  it("samples list offers an inline delete only via the same gate", () => {
    expect(list).toContain("isSoilSampleDeletable(s.extraction_status)");
    expect(list).toContain("DeleteSampleDialog");
  });
  it("confirmation dialog states permanence and requires the explicit action", () => {
    expect(dialog).toContain("cannot be undone");
    expect(dialog).toContain("Delete permanently");
    expect(dialog).toContain("original uploaded");
  });
});
