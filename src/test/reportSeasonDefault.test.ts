// Cost Reports (Vineyard Costings) opens on the vineyard's current Vintage
// when that Vintage has records; "All" is only the fallback when it does not.
import { describe, it, expect } from "vitest";
import { defaultSeasonOption } from "@/lib/reportSeasonDefault";

describe("report season default", () => {
  it("defaults to the current Vintage when it has records", () => {
    expect(defaultSeasonOption([2025, 2026, 2027], 2027)).toBe(2027);
  });

  it("falls back to All when the current Vintage has no records", () => {
    expect(defaultSeasonOption([2024, 2025], 2027)).toBeNull();
  });

  it("falls back to All when no vintages exist yet", () => {
    expect(defaultSeasonOption([], 2027)).toBeNull();
  });

  it("falls back to All when the current Vintage is unknown", () => {
    expect(defaultSeasonOption([2027], null)).toBeNull();
  });
});
