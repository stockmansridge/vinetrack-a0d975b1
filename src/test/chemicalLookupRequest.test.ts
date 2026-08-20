import { describe, it, expect } from "vitest";
import { buildStructuredLookupBody } from "@/lib/chemicalLookupRequest";

describe("structured chemical lookup request body", () => {
  it("always carries action:structured (missing it returns 400 Unknown action)", () => {
    const body = buildStructuredLookupBody("Spray Seal", "AU");
    expect(body.action).toBe("structured");
    expect(body.productName).toBe("Spray Seal");
  });

  it("sends the ISO-2 country as `country` (country_code alone resolves to no_country)", () => {
    const body = buildStructuredLookupBody("Custodia 320SC", "AU");
    expect(body.country).toBe("AU");
    expect(body.country_code).toBe("AU");
    expect(body.structured).toBe(true);
  });
});
