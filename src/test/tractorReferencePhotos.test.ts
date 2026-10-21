import { describe, expect, it } from "vitest";
import { matchTractorReferencePhoto, type TractorReferencePhoto } from "@/lib/tractorReferencePhotos";

const catalogue: TractorReferencePhoto[] = [{
  brands: ["John Deere", "JD"], models: ["5055E"], firstYear: 2008, lastYear: 2014,
  url: "/test-photo.jpg", sourceUrl: "https://example.test/source", attribution: "Test fixture", label: "John Deere 5055E", attachmentFree: true,
}];
const tractor = { brand: "John Deere", model: "5055E", model_year: 2010 };

describe("tractor reference photo identity", () => {
  it.each([false, undefined])("rejects attachments or unverified attachment status %s", (attachmentFree) => {
    expect(matchTractorReferencePhoto(tractor, catalogue.map((photo) => ({ ...photo, attachmentFree })))).toBeNull();
  });
  it("matches a complete exact identity with case and spacing differences", () => {
    expect(matchTractorReferencePhoto({ ...tractor, brand: " john deere ", model: "5055 e" }, catalogue)).toBe(catalogue[0]);
  });
  it.each([
    { ...tractor, brand: null }, { ...tractor, model: " " }, { ...tractor, model_year: null },
  ])("requires brand, model and year", (input) => {
    expect(matchTractorReferencePhoto(input, catalogue)).toBeNull();
  });
  it("never substitutes another model", () => {
    expect(matchTractorReferencePhoto({ ...tractor, model: "5065E" }, catalogue)).toBeNull();
  });
  it.each([2007, 2015, 2010.5])("rejects unsupported year %s", (year) => {
    expect(matchTractorReferencePhoto({ ...tractor, model_year: year }, catalogue)).toBeNull();
  });
});