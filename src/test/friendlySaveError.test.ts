import { describe, it, expect } from "vitest";
import { friendlySaveError } from "@/lib/friendlySaveError";

describe("friendlySaveError", () => {
  it("translates a missing work date", () => {
    expect(
      friendlySaveError({
        message:
          'null value in column "work_date" of relation "work_task_labour_lines" violates not-null constraint',
      }),
    ).toBe("Work date is missing. Please set one, then press save again.");
  });
  it("translates permission errors", () => {
    expect(friendlySaveError({ message: "new row violates row-level security policy" }, "labour details"))
      .toBe("You don't have permission to save labour details for this vineyard.");
  });
  it("never shows raw database wording", () => {
    expect(friendlySaveError({ message: 'duplicate key violates unique constraint on relation "x"' }))
      .toBe("Something went wrong while saving. Please try again.");
  });
});
