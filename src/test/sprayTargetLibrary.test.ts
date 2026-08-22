// SQL 204 — portal consumption of the vineyard spray target library.
import { describe, it, expect } from "vitest";
import {
  slugifySprayTarget,
  sprayTargetLabel,
  isBuiltInSprayTarget,
  prettifySprayTargetIdentifier,
} from "@/lib/sprayTargetLibrary";
import { fromLegacySprayJob } from "@/lib/sprayApplicationDomain";

describe("spray target slugs", () => {
  it("produces the shared identifier shape", () => {
    expect(slugifySprayTarget("Eutypa Dieback")).toBe("eutypa_dieback");
    expect(slugifySprayTarget("  Eutypa  die-back ")).toBe("eutypa_die_back");
    expect(slugifySprayTarget("Light Brown Apple Moth (LBAM)")).toBe(
      "light_brown_apple_moth_lbam",
    );
    expect(slugifySprayTarget("   ")).toBe("");
  });

  it("keeps built-in wording authoritative over the library", () => {
    const lib = new Map([["botrytis", "Botrytis bunch rot (ours)"]]);
    expect(isBuiltInSprayTarget("botrytis")).toBe(true);
    expect(sprayTargetLabel("botrytis", lib)).toBe("Botrytis");
  });

  it("uses library wording for custom targets, punctuation intact", () => {
    const lib = new Map([["light_brown_apple_moth_lbam", "Light Brown Apple Moth (LBAM)"]]);
    expect(sprayTargetLabel("light_brown_apple_moth_lbam", lib)).toBe(
      "Light Brown Apple Moth (LBAM)",
    );
  });

  it("still displays an unknown identifier rather than dropping it", () => {
    expect(prettifySprayTargetIdentifier("eutypa_dieback")).toBe("Eutypa dieback");
    expect(sprayTargetLabel("eutypa_dieback", new Map())).toBe("Eutypa dieback");
  });
});

describe("hydration keeps custom identifiers", () => {
  it("does not discard a slug that is not a built-in target", () => {
    const application = fromLegacySprayJob({
      id: "j1",
      vineyard_id: "v1",
      is_template: true,
      targets: ["powdery_mildew", "eutypa_dieback"],
    } as any);
    expect(application.targets).toEqual(["powdery_mildew", "eutypa_dieback"]);
  });
});
