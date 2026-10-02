import { describe, it, expect } from "vitest";
import { shortManufacturerName as s } from "@/lib/manufacturerNormalise";
describe("shortManufacturerName", () => {
  it.each([
    ["BASF Australia Ltd", "BASF"], ["CropSure Pty Ltd", "CropSure"],
    ["Omnia Specialities Australia Pty Ltd", "Omnia Specialities"], ["SACOA Pty Ltd", "SACOA"],
    ["Syngenta Australia Pty Ltd", "Syngenta"], ["Nufarm Australia Limited", "Nufarm"],
    ["Acme Pty. Ltd.", "Acme"], ["Australia Bio Pty Ltd", "Australia Bio"],
    ["Grow Australia", "Grow Australia"], ["Ltd", "Ltd"], ["", ""],
  ])("%s → %s", (i, o) => expect(s(i)).toBe(o));
});
