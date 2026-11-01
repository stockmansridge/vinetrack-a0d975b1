import { describe, expect, it } from "vitest";
import {
  areaError,
  haTextFromM2,
  isAreaTypingAllowed,
  parseAreaHa,
  servicedAreaM2ForSave,
} from "./irrigationServicedArea";

describe("irrigated area conversion", () => {
  it("converts saved m² to ha for display", () => {
    expect(haTextFromM2(25000)).toBe("2.5");
    expect(haTextFromM2(3000)).toBe("0.3");
    expect(haTextFromM2(1)).toBe("0.0001");
  });
  it("shows missing/zero saved area as blank, never 0", () => {
    expect(haTextFromM2(null)).toBe("");
    expect(haTextFromM2(undefined)).toBe("");
    expect(haTextFromM2(0)).toBe("");
  });
  it("converts entered ha to m²", () => {
    expect(servicedAreaM2ForSave("1.25")).toBe(12500);
    expect(servicedAreaM2ForSave("0.5")).toBe(5000);
    expect(servicedAreaM2ForSave("")).toBeNull();
  });
  it("round-trips a preexisting area through reopen", () => {
    const text = haTextFromM2(12345);
    expect(servicedAreaM2ForSave(text)).toBeCloseTo(12345, 6);
  });
});

describe("decimal typing", () => {
  it("accepts partial subhectare input", () => {
    for (const t of ["", "0", "0.", ".", ".5", "0.05", "12.75"]) expect(isAreaTypingAllowed(t)).toBe(true);
  });
  it("rejects non-numeric keystrokes", () => {
    for (const t of ["a", "1..2", "-1", "1e3", "1,5"]) expect(isAreaTypingAllowed(t)).toBe(false);
  });
  it("treats in-progress '0.' and '0' as invalid, not zero", () => {
    expect(parseAreaHa("0.").kind).toBe("invalid");
    expect(parseAreaHa("0").kind).toBe("invalid");
    expect(parseAreaHa(".").kind).toBe("invalid");
  });
});

describe("validation by method", () => {
  it("requires area for irrigated_area", () => {
    expect(areaError("", "irrigated_area")).toMatch(/required/);
    expect(areaError("0.4", "irrigated_area")).toBeNull();
  });
  it("keeps area optional but validated for other methods", () => {
    for (const m of ["manual_percentage", "vine_count", "emitter_count"]) {
      expect(areaError("", m)).toBeNull();
      expect(areaError("0", m)).toMatch(/greater than 0/);
    }
  });
  it("submits correct per-block numerators for multi-block area weighting", () => {
    const payload = ["1.2", "0.8"].map(servicedAreaM2ForSave);
    expect(payload).toEqual([12000, 8000]);
  });
  it("refuses to save invalid area", () => {
    expect(() => servicedAreaM2ForSave("0")).toThrow();
  });
});
