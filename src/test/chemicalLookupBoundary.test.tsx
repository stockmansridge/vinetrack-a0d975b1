// Chemical lookup BOUNDARY contract.
//
// Two hard boundaries are enforced here:
//   1. A failed/timed-out `action: "search"` must NEVER escalate into a full
//      structured free-text lookup (register + research + label work).
//   2. "Already in your Chemical Store" requires an exact registration-number
//      identity on BOTH sides. A name-only saved chemical proves nothing.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { savedChemicalForCandidate, parseSearchCandidates } from "@/lib/chemicalSearchFlow";
import { candidatePrompt } from "@/lib/chemicalSearchMessaging";

const invoke = vi.fn();

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/lib/masterChemicals", () => ({
  searchApprovedMasterChemicals: vi.fn(async () => []),
}));

import { ChemicalAILookup } from "@/components/spray/ChemicalAILookup";

const REGISTERED = {
  registered_product_name: "VICOL WINTER OIL INSECTICIDE",
  registrant: "Victorian Chemical Company",
  registration_number: "33182",
  registration_scheme: "APVMA",
  registration_country: "AU",
  active_ingredient: "Petroleum Oil 861 g/L",
  product_category: "Insecticide",
};

const NAME_ONLY = {
  registered_product_name: "Hortitrol Winter Oil",
  registrant: "Vic Chem",
};

const searchOk = (rows: unknown[]) => ({
  data: { candidates: rows, ranking_summary: { ambiguous: true } },
  error: null,
});

const renderLookup = (existingLibrary: any[] = []) =>
  render(
    <ChemicalAILookup country="Australia" existingLibrary={existingLibrary} onApply={() => {}} />,
  );

const typeAndSearch = async (q = "winter oil") => {
  fireEvent.change(screen.getByLabelText("Search product"), { target: { value: q } });
  fireEvent.click(screen.getByRole("button", { name: "Lookup" }));
};

const bodiesOf = () =>
  invoke.mock.calls.map((c) => (c[1] as any)?.body ?? {});

beforeEach(() => {
  invoke.mockReset();
});

describe("search failure never starts a structured free-text lookup", () => {
  it("shows retry/manual and fires no structured request on timeout", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: "Chemical research unavailable (timeout): exceeded 55000ms" },
    });
    renderLookup();
    await typeAndSearch("hortitrol");

    await screen.findByRole("button", { name: "Retry search" });
    expect(screen.getByRole("button", { name: "Enter manually" })).toBeInTheDocument();
    expect(
      screen.getByText(/product search took too long/i),
    ).toBeInTheDocument();
    // Search only. No structured escalation on the free text.
    const bodies = bodiesOf();
    expect(bodies.length).toBe(1);
    expect(bodies[0].action).toBe("search");
    expect(bodies.some((b) => b.action === "structured")).toBe(false);
    // The typed query survives for the retry.
    expect((screen.getByLabelText("Search product") as HTMLInputElement).value).toBe("hortitrol");
  });

  it("does not promise multi-minute searches in the search error", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "timeout" } });
    renderLookup();
    await typeAndSearch();
    await screen.findByRole("button", { name: "Retry search" });
    expect(screen.queryByText(/take a few minutes/i)).toBeNull();
  });
});

describe("saved chemical identity is registration-number only", () => {
  const cand = (raw: Record<string, unknown>) =>
    parseSearchCandidates({ candidates: [raw] }).candidates[0];

  it("does not badge a name-only saved chemical", () => {
    const saved = [{ id: "s1", name: "Hortitrol Winter Oil", registration_number: null }];
    expect(savedChemicalForCandidate(saved, cand(NAME_ONLY))).toBeNull();
  });

  it("does not badge when only the saved side lacks a registration", () => {
    const saved = [{ id: "s1", name: "VICOL WINTER OIL INSECTICIDE", registration_number: null }];
    expect(savedChemicalForCandidate(saved, cand(REGISTERED))).toBeNull();
  });

  it("badges an exact registration match", () => {
    const saved = [{ id: "s1", name: "Anything", registration_number: "33182" }];
    expect(savedChemicalForCandidate(saved, cand(REGISTERED))?.id).toBe("s1");
  });

  it("renders the badge only for the registration match", async () => {
    invoke.mockResolvedValue(searchOk([NAME_ONLY]));
    renderLookup([{ id: "s1", name: "Hortitrol Winter Oil", registration_number: null }]);
    await typeAndSearch("hortitrol winter oil");
    // Same-name saved chemical: the operator confirms the update check first.
    fireEvent.click(await screen.findByRole("button", { name: /check for updates/i }));
    await screen.findByText("Hortitrol Winter Oil");
    expect(screen.queryByText("Already in your Chemical Store")).toBeNull();
  });

});

describe("candidate presentation", () => {
  it("labels a candidate without a registration number as unverified", async () => {
    invoke.mockResolvedValue(searchOk([NAME_ONLY]));
    renderLookup();
    await typeAndSearch();
    await screen.findByText("Hortitrol Winter Oil");
    expect(screen.getAllByText("Unverified suggestion").length).toBeGreaterThan(0);
    expect(screen.queryByText("Possible registered product")).toBeNull();
    expect(screen.queryByText("Registered product found")).toBeNull();
    // Manufacturer is still useful context.
    expect(screen.getByText("Vic Chem")).toBeInTheDocument();
  });

  it("prompt copy for name-only candidates avoids registered wording", () => {
    const res = parseSearchCandidates({ candidates: [NAME_ONLY] });
    expect(candidatePrompt(res).kind).toBe("unverified");
    expect(candidatePrompt(res).title).toBe("Unverified suggestion");
  });

  it("shows the grower-useful fields for a validated registration", async () => {
    invoke.mockResolvedValue(searchOk([REGISTERED]));
    renderLookup();
    await typeAndSearch();
    await screen.findByText("VICOL WINTER OIL INSECTICIDE");
    expect(screen.getByText("Victorian Chemical Company")).toBeInTheDocument();
    expect(screen.getByText("Petroleum Oil 861 g/L")).toBeInTheDocument();
    expect(screen.getByText("Insecticide")).toBeInTheDocument();
    expect(screen.getByText("APVMA 33182")).toBeInTheDocument();
    expect(screen.queryByText("Scheme")).toBeNull();
  });
});

describe("one-step selection and enrichment recovery", () => {
  it("starts the exact structured lookup straight from selection", async () => {
    invoke
      .mockResolvedValueOnce(searchOk([REGISTERED, NAME_ONLY]))
      .mockResolvedValueOnce({
        data: {
          match_source: "authoritative",
          jurisdiction: { country_code: "AU", registration_scheme: "apvma" },
          field_provenance: { registered_product_name: "official_label" },
          product: {
            registered_product_name: "VICOL WINTER OIL INSECTICIDE",
            registration_country: "AU",
            registration_number: "33182",
          },
        },
        error: null,
      });
    renderLookup();
    await typeAndSearch();
    fireEvent.click((await screen.findAllByRole("button", { name: "Select this product" }))[0]);

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    const structured = bodiesOf()[1];
    expect(structured.action).toBe("structured");
    expect(structured.exact_registration_number).toBe("33182");
    // No second confirmation step.
    expect(screen.queryByRole("button", { name: /load label/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^apply/i })).toBeNull();
  });

  it("keeps the selected product and offers a label retry when enrichment times out", async () => {
    invoke
      .mockResolvedValueOnce(searchOk([REGISTERED]))
      .mockResolvedValue({
        data: null,
        error: { message: "Chemical research unavailable (timeout): exceeded 55000ms" },
      });
    renderLookup();
    await typeAndSearch();
    fireEvent.click((await screen.findAllByRole("button", { name: "Select this product" }))[0]);

    await screen.findByRole("button", { name: "Retry label details" });
    expect(screen.getByText(/label details took too long/i)).toBeInTheDocument();
    // Identity stays on screen, and no new search was fired.
    expect(screen.getByText("VICOL WINTER OIL INSECTICIDE")).toBeInTheDocument();
    expect(bodiesOf().filter((b) => b.action === "search").length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry label details" }));
    await waitFor(() => expect(bodiesOf().filter((b) => b.action === "structured").length).toBe(2));
    expect(bodiesOf().filter((b) => b.action === "search").length).toBe(1);
  });
});
