import { describe, it, expect } from "vitest";
import { parseRowRanges, parseRowRangesDetail } from "@/lib/pruningCalc";

describe("parseRowRanges", () => {
  const available = [42, 43, 44, 45, 46];

  it("single row", () => {
    expect(parseRowRanges("44", available)).toEqual([44]);
  });

  it("ascending range", () => {
    expect(parseRowRanges("44-46", available)).toEqual([44, 45, 46]);
  });

  it("descending range", () => {
    expect(parseRowRanges("46-44", available)).toEqual([44, 45, 46]);
  });

  it("whitespace around dash", () => {
    expect(parseRowRanges("44 - 46", available)).toEqual([44, 45, 46]);
    expect(parseRowRanges("44 -46", available)).toEqual([44, 45, 46]);
    expect(parseRowRanges("44- 46", available)).toEqual([44, 45, 46]);
  });

  it("multiple comma-separated ranges", () => {
    expect(parseRowRanges("1-10, 15, 20-22", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 21, 22])).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 21, 22],
    );
  });

  it("non-sequential configured rows never invents missing numbers", () => {
    expect(parseRowRanges("2-5", [1, 2, 3, 5, 6])).toEqual([2, 3, 5]);
  });

  it("filters row numbers not present", () => {
    expect(parseRowRanges("40-50", available)).toEqual([42, 43, 44, 45, 46]);
    expect(parseRowRanges("100", available)).toEqual([]);
  });

  it("ignores duplicates", () => {
    expect(parseRowRanges("44, 44, 44-45", available)).toEqual([44, 45]);
  });

  it("empty input returns empty", () => {
    expect(parseRowRanges("", available)).toEqual([]);
    expect(parseRowRanges("   ", available)).toEqual([]);
  });

  it("reports invalid tokens", () => {
    const res = parseRowRangesDetail("44, foo, 45-", available);
    expect(res.nums).toEqual([44]);
    expect(res.invalid).toEqual(["foo", "45-"]);
  });
});
