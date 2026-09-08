// "Set vineyard country" recovery action shown wherever chemical lookup is
// blocked. The jurisdiction guard itself must stay closed throughout.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateSpy };
});

const invoke = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

let role: string | null = "owner";
let currentCountry: string | null = null;
vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({
    memberships: [],
    loading: false,
    selectedVineyardId: "v1",
    selectVineyard: () => {},
    currentRole: role,
    currentCountry,
  }),
}));

import { ChemicalAILookup } from "@/components/spray/ChemicalAILookup";
import {
  ASK_OWNER_MANAGER_MESSAGE,
  SET_VINEYARD_COUNTRY_LABEL,
  VINEYARD_COUNTRY_PROMPT,
  VINEYARD_COUNTRY_SETTINGS_TARGET,
  canEditVineyardCountry,
  consumeCountryReturnContext,
  clearCountryReturnContext,
  readCountryReturnContext,
  saveCountryReturnContext,
} from "@/lib/vineyardCountryRecovery";

function renderLookup(country: string | null) {
  return render(
    <MemoryRouter initialEntries={["/setup/chemicals"]}>
      <QueryClientProvider client={new QueryClient()}>
        <ChemicalAILookup
          country={country}
          onApply={() => {}}
          captureDraft={() => ({ editor: "new", form: { name: "Copper" } })}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  role = "owner";
  currentCountry = null;
  navigateSpy.mockReset();
  invoke.mockReset();
  clearCountryReturnContext();
});
afterEach(() => clearCountryReturnContext());

describe("missing vineyard country", () => {
  it("offers the recovery action to an owner and never calls lookup", () => {
    renderLookup(null);
    expect(screen.getByText(VINEYARD_COUNTRY_PROMPT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lookup" }));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("offers the recovery action to a manager", () => {
    role = "manager";
    renderLookup(null);
    expect(screen.getByRole("button", { name: SET_VINEYARD_COUNTRY_LABEL })).toBeTruthy();
  });

  it("tells a member without settings permission who to ask, with no edit action", () => {
    role = "worker";
    renderLookup(null);
    expect(screen.getByText(ASK_OWNER_MANAGER_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: SET_VINEYARD_COUNTRY_LABEL })).toBeNull();
  });

  it("keeps Enter manually available without a country", () => {
    renderLookup(null);
    expect(screen.getByRole("button", { name: /enter manually/i })).toBeTruthy();
  });

  it("navigates to the vineyard profile country field and preserves the draft", () => {
    renderLookup(null);
    fireEvent.change(screen.getByLabelText("Search product"), {
      target: { value: "Kocide" },
    });
    fireEvent.click(screen.getByRole("button", { name: SET_VINEYARD_COUNTRY_LABEL }));
    expect(navigateSpy).toHaveBeenCalledWith(VINEYARD_COUNTRY_SETTINGS_TARGET);
    expect(VINEYARD_COUNTRY_SETTINGS_TARGET).toBe("/setup/vineyard#vcountry");
    const ctx = readCountryReturnContext();
    expect(ctx?.path).toBe("/setup/chemicals");
    expect((ctx?.state as any).searchText).toBe("Kocide");
    expect((ctx?.state as any).editor).toBe("new");
    expect((ctx?.state as any).form.name).toBe("Copper");
  });

  it("hides the recovery action once a country exists and allows lookup", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("offline") });
    renderLookup("Australia");
    expect(screen.queryByText(VINEYARD_COUNTRY_PROMPT)).toBeNull();
    fireEvent.change(screen.getByLabelText("Search product"), {
      target: { value: "Kocide" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lookup" }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
  });
});

describe("return context lifecycle", () => {
  it("only restores on the originating screen and is consumed once", () => {
    saveCountryReturnContext({ path: "/setup/chemicals?x=1", label: "chemicals", state: { a: 1 } });
    expect(consumeCountryReturnContext("/spray-jobs")).toBeNull();
    expect(consumeCountryReturnContext("/setup/chemicals")?.state).toEqual({ a: 1 });
    expect(consumeCountryReturnContext("/setup/chemicals")).toBeNull();
  });

  it("cancelling (no save) leaves lookup blocked", () => {
    // Country is still missing after returning: the guard is unchanged.
    renderLookup(null);
    fireEvent.click(screen.getByRole("button", { name: "Lookup" }));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("restricts the edit action to owners and managers", () => {
    expect(canEditVineyardCountry("owner")).toBe(true);
    expect(canEditVineyardCountry("manager")).toBe(true);
    expect(canEditVineyardCountry("worker")).toBe(false);
    expect(canEditVineyardCountry(null)).toBe(false);
  });
});

describe("country context changes", () => {
  it("discards stale results and ignores late responses from the previous context", async () => {
    let resolveSearch: ((v: unknown) => void) | null = null;
    invoke.mockImplementation(
      () => new Promise((res) => {
        resolveSearch = res;
      }),
    );
    const view = render(
      <MemoryRouter initialEntries={["/setup/chemicals"]}>
        <QueryClientProvider client={new QueryClient()}>
          <ChemicalAILookup country="Australia" onApply={() => {}} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Search product"), {
      target: { value: "Kocide" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lookup" }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());

    // Vineyard switches to a different country mid-flight.
    view.rerender(
      <MemoryRouter initialEntries={["/setup/chemicals"]}>
        <QueryClientProvider client={new QueryClient()}>
          <ChemicalAILookup country="New Zealand" onApply={() => {}} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    resolveSearch?.({
      data: {
        candidates: [{ product_name: "Kocide", registration_number: "1234" }],
        country: "AU",
      },
      error: null,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/Kocide/)).toBeNull();
    expect(screen.queryByText(/Searching registered products/)).toBeNull();
  });
});
