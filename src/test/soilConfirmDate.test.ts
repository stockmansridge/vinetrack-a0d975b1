// Confirmation requires a sample date (soil_samples_confirmed_date_chk) but
// Save review does not; the page explains instead of surfacing a raw error.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const update = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    from: () => ({ update: (p: unknown) => { update(p); return { eq: async () => ({ error: null }) }; } }),
  },
}));

import {
  confirmSoilSample,
  hasConfirmableSampleDate,
  MissingSampleDateError,
  CONFIRM_DATE_REQUIRED_MESSAGE,
} from "@/lib/soilAnalysis";

const detail = readFileSync("src/pages/admin/SoilSampleDetailPage.tsx", "utf8");
const saveFn = detail.slice(detail.indexOf("const save = async"), detail.indexOf("const confirm = async"));
const confirmFn = detail.slice(detail.indexOf("const confirm = async"), detail.indexOf("const retry = async"));

beforeEach(() => update.mockClear());

describe("sample date and confirmation", () => {
  it("Save review does not require sampled_at", () => {
    expect(saveFn).not.toContain("hasConfirmableSampleDate");
    expect(saveFn).not.toContain("CONFIRM_DATE_REQUIRED_MESSAGE");
    expect(saveFn).toContain("sampled_at: (draft.sampled_at as string) ?? null");
  });
  it("blank date is not confirmable; a date is", () => {
    expect(hasConfirmableSampleDate(null)).toBe(false);
    expect(hasConfirmableSampleDate("")).toBe(false);
    expect(hasConfirmableSampleDate("2025-04-10")).toBe(true);
  });
  it("confirmSoilSample refuses a null date without any confirmed update", async () => {
    await expect(confirmSoilSample("s1", "u1", null)).rejects.toBeInstanceOf(MissingSampleDateError);
    expect(update).not.toHaveBeenCalled();
  });
  it("confirmSoilSample with a date writes the confirmed update", async () => {
    await confirmSoilSample("s1", "u1", "2025-04-10");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ extraction_status: "confirmed" }));
  });
  it("Confirm saves first, then stops before confirming when the date is blank", () => {
    const saveIdx = confirmFn.indexOf("await save()");
    const checkIdx = confirmFn.indexOf("!hasConfirmableSampleDate(sampledAt)");
    const returnIdx = confirmFn.indexOf("return;", checkIdx);
    const confirmIdx = confirmFn.indexOf("await confirmSoilSample(");
    expect(saveIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeGreaterThan(saveIdx);
    expect(returnIdx).toBeLessThan(confirmIdx);
    expect(confirmFn).toContain("confirmSoilSample(sample.id, user.id, sampledAt)");
  });
  it("user sees the human message, never the raw constraint", () => {
    expect(CONFIRM_DATE_REQUIRED_MESSAGE).toBe(
      "Review saved. Add a sample date before confirming this soil sample.",
    );
    expect(confirmFn).toContain("setSaveState(CONFIRM_DATE_REQUIRED_MESSAGE)");
    expect(detail).not.toContain("soil_samples_confirmed_date_chk\"");
    expect(new MissingSampleDateError().message).not.toContain("soil_samples_confirmed_date_chk");
  });
  it("Sample date shows the confirmation helper for unconfirmed samples", () => {
    expect(detail).toContain("Required before confirmation.");
    expect(detail).toContain('sample.extraction_status !== "confirmed"');
  });
});
