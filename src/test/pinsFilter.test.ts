import { describe, expect, it } from "vitest";
import { matchesPinSearch, matchesRowRange, parseRowBound, placementRowNumbers } from "@/lib/pinsFilter";

describe("row range filtering", () => {
  it("parses bounds and ignores blanks", () => {
    expect(parseRowBound("")).toBeNull();
    expect(parseRowBound(" 12 ")).toBe(12);
    expect(parseRowBound("abc")).toBeNull();
  });

  it("matches on pin and driving row numbers", () => {
    const row = { pin_id: "p", pin_row_number: 19, driving_row_number: 19.5 };
    expect(matchesRowRange(row, 10, 20)).toBe(true);
    expect(matchesRowRange(row, 20, null)).toBe(false);
    expect(matchesRowRange(row, null, 19)).toBe(true);
  });

  it("matches rows listed in a server row summary", () => {
    const row = { pin_id: "p", row_summary: "Rows 2–3 · Row 5 (sections 1–2)" };
    expect(placementRowNumbers(row)).toContain(5);
    expect(matchesRowRange(row, 5, 5)).toBe(true);
    expect(matchesRowRange(row, 40, 50)).toBe(false);
  });

  it("passes everything through when no bound is set", () => {
    expect(matchesRowRange(null, null, null)).toBe(true);
    expect(matchesRowRange(null, 1, null)).toBe(false);
  });
});

describe("pin search", () => {
  const pin = { title: "Broken post", notes: "near gate", status: "open" };

  it("matches the block label so typing a block name works", () => {
    expect(matchesPinSearch(pin, "Pinot Noir", "Row 4", "pinot")).toBe(true);
  });

  it("matches title and notes", () => {
    expect(matchesPinSearch(pin, "", "", "broken")).toBe(true);
    expect(matchesPinSearch(pin, "", "", "gate")).toBe(true);
    expect(matchesPinSearch(pin, "", "", "shiraz")).toBe(false);
  });

  it("empty term matches everything", () => {
    expect(matchesPinSearch(pin, "", "", "  ")).toBe(true);
  });
});
