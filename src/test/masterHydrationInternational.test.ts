// Master hydration is identity-by-master_chemical_id; registration data is
// optional evidence, validated only when present. International contract.
import { describe, it, expect, vi } from "vitest";
import {
  hydrateMasterSelection,
  masterHydrationRequestBody,
  parseMasterHydration,
  type MasterSearchHit,
} from "@/lib/chemicalSearchV2";

const OPTIONS = {
  per_hectare: [
    {
      option_key: "default_option_v1_x", rate_ids: ["rate_v1_x"], direction_ids: ["direction_v1_x"],
      basis: "per_hectare", unit: "L", value: 2, min_value: null, max_value: null,
      targets: [], conditions: [], crops: ["Grapevines"], condition_ambiguous: false,
    },
  ],
  per_100_litres: [],
};

const mkHit = (over: Partial<MasterSearchHit>): MasterSearchHit =>
  ({
    id: "m-1", productName: "Product", registrationNumber: "", registrationScheme: "",
    registrationCountry: "", reviewStatus: "approved", ...over,
  }) as MasterSearchHit;

const served = (over: Record<string, unknown> = {}) => ({
  master_chemical_id: "m-1", default_rate_options: OPTIONS, ...over,
});

const run = async (hit: MasterSearchHit, data: unknown, opts = {}) => {
  const invoke = vi.fn().mockResolvedValue({ data, error: null });
  const res = await hydrateMasterSelection(hit, invoke, opts);
  return { res, body: invoke.mock.calls[0]?.[0] as Record<string, unknown> | undefined };
};

describe("international Master hydration", () => {
  it("1. AU with APVMA number validates registration", async () => {
    const hit = mkHit({ registrationCountry: "AU", registrationScheme: "apvma", registrationNumber: "53576" });
    const { res, body } = await run(hit, served({ registration_number: "53576", registration_country: "AU", registration_identity_key: "AU:apvma:53576" }));
    expect(res.status).toBe("hydrated");
    expect(body).toMatchObject({ registrationNumber: "53576", registrationScheme: "apvma", country_code: "AU" });
  });

  it("2. NZ with ACVM number validates registration", async () => {
    const hit = mkHit({ registrationCountry: "NZ", registrationScheme: "acvm", registrationNumber: "P001234" });
    const { res } = await run(hit, served({ registration_number: "P001234", registration_scheme: "acvm", registration_country: "NZ" }));
    expect(res.status).toBe("hydrated");
  });

  it("3. France with no registration hydrates by exact Master ID", async () => {
    const hit = mkHit({ registrationCountry: "FR" });
    const { res, body } = await run(hit, served({ registration_country: "FR" }));
    expect(res.status).toBe("hydrated");
    expect(body).not.toHaveProperty("registrationNumber");
    expect(body).not.toHaveProperty("registrationScheme");
    expect(body).toMatchObject({ country_code: "FR", master_chemical_id: "m-1" });
  });

  it("4. US registration metadata is retained and validated without APVMA assumptions", async () => {
    const hit = mkHit({ registrationCountry: "US", registrationScheme: "epa", registrationNumber: "100-1234" });
    const { res, body } = await run(hit, served({ registration_number: "100-1234", registration_scheme: "epa", registration_country: "US" }));
    expect(res.status).toBe("hydrated");
    expect(body).toMatchObject({ registrationScheme: "epa", registrationNumber: "100-1234", country_code: "US" });
    expect(JSON.stringify(body).toLowerCase()).not.toContain("apvma");
  });

  it("5. South Africa with no register adapter still hydrates", async () => {
    const { res } = await run(mkHit({ registrationCountry: "ZA" }), served());
    expect(res.status).toBe("hydrated");
  });

  it("6. unregistered fertiliser/biostimulant hydrates without registration fields", async () => {
    const { res } = await run(mkHit({ productName: "Seaweed biostimulant" }), served(), { country: "CL" });
    expect(res.status).toBe("hydrated");
  });

  it("7. exact Master ID mismatch rejects", () => {
    expect(parseMasterHydration(mkHit({}), served({ master_chemical_id: "m-2" })).status).toBe("identity_mismatch");
  });

  it("8. registration mismatch rejects when registration was supplied", () => {
    const hit = mkHit({ registrationCountry: "AU", registrationScheme: "apvma", registrationNumber: "53576" });
    expect(parseMasterHydration(hit, served({ registration_number: "62723" })).status).toBe("identity_mismatch");
    expect(parseMasterHydration(hit, served({ registration_scheme: "acvm" })).status).toBe("identity_mismatch");
    expect(parseMasterHydration(hit, served({ registration_country: "NZ" })).status).toBe("identity_mismatch");
  });

  it("9. missing registration fields on either side never reject on their own", () => {
    const registered = mkHit({ registrationCountry: "AU", registrationScheme: "apvma", registrationNumber: "53576" });
    expect(parseMasterHydration(registered, served()).status).toBe("hydrated");
    expect(parseMasterHydration(mkHit({}), served({ registration_number: "X1" })).status).toBe("hydrated");
  });

  it("candidate + System Admin uses structured_master_preview; unknown country is never defaulted to AU", () => {
    const cand = mkHit({ reviewStatus: "candidate", registrationCountry: "IT" });
    const body = masterHydrationRequestBody(cand, "c", { adminCandidatePreview: true });
    expect(body).toMatchObject({ action: "structured_master_preview", admin_candidate_preview: true, country_code: "IT" });
    const none = masterHydrationRequestBody(mkHit({}), "c");
    expect(none.action).toBe("structured");
    expect(none).not.toHaveProperty("country");
  });
});
