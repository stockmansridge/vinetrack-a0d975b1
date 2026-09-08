// Generic legacy trip-report tank parsing only.
// The Spray Report renders the canonical get_spray_report_v1 payload and must
// never rely on these legacy key fallbacks.
import { describe, it, expect } from "vitest";
import { parseTankSessions } from "@/lib/tripReport";

describe("parseTankSessions legacy row keys", () => {
  it("counts rows_covered", () => {
    expect(parseTankSessions([{ tank_number: 1, rows_covered: ["1", "2", "3"] }])[0].rows).toBe("3");
  });

  it("accepts the legacy paths_covered array", () => {
    expect(parseTankSessions([{ tank_number: 1, paths_covered: ["1", "2"] }])[0].rows).toBe("2");
  });

  it("prefers rows_covered when both are present", () => {
    expect(
      parseTankSessions([{ tank_number: 1, rows_covered: ["1"], paths_covered: ["1", "2", "3"] }])[0]
        .rows,
    ).toBe("1");
  });

  it("falls back to a paths_covered_count scalar", () => {
    expect(parseTankSessions([{ tank_number: 1, paths_covered_count: 7 }])[0].rows).toBe("7");
  });

  it("shows an em dash when nothing was recorded", () => {
    expect(parseTankSessions([{ tank_number: 1 }])[0].rows).toBe("—");
  });
});
