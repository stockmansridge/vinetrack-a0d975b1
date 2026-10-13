import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isAustralianVineyard, wineGrapeLevyAccess } from "@/lib/wineGrapeLevyAccess";
import {
  ACTIVITIES,
  accessibleViews,
  reportDestinations,
  searchDestinations,
  type NavViewer,
} from "@/lib/navigationConfig";

const ctx = vi.hoisted(() => ({
  value: { selectedVineyardId: "v1", currentRole: "owner", currentCountry: "Australia" as string | null, loading: false },
  dbCountry: "Australia" as string | null,
}));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ctx.value }));
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { country: ctx.dbCountry }, error: null }) }) }),
    }),
  },
}));
import { WineGrapeLevyGate } from "@/components/reports/WineGrapeLevyGate";

const PATH = "/reports/wine-grape-levy";

describe("isAustralianVineyard", () => {
  it.each(["Australia", "AU", "au", "australia", "  AUSTRALIA ", "Commonwealth of Australia", "aus"])("%s → AU", (c) =>
    expect(isAustralianVineyard(c)).toBe(true),
  );
  it.each(["New Zealand", "NZ", "US", "France", null, undefined, "", "  ", "Narnia", "A", 42])("%s blocked", (c) =>
    expect(isAustralianVineyard(c)).toBe(false),
  );
});

describe("wineGrapeLevyAccess", () => {
  it("owner/manager in AU allowed; supervisor/operator not", () => {
    for (const role of ["owner", "manager"]) expect(wineGrapeLevyAccess({ role, country: "AU", loading: false })).toBe("allowed");
    for (const role of ["supervisor", "operator", null]) expect(wineGrapeLevyAccess({ role, country: "AU", loading: false })).toBe("role");
  });
  it("distinguishes foreign vs missing and never grants while loading", () => {
    expect(wineGrapeLevyAccess({ role: "owner", country: "New Zealand", loading: false })).toBe("country-foreign");
    expect(wineGrapeLevyAccess({ role: "owner", country: null, loading: false })).toBe("country-missing");
    expect(wineGrapeLevyAccess({ role: "owner", country: "garbage", loading: false })).toBe("country-missing");
    expect(wineGrapeLevyAccess({ role: "owner", country: "AU", loading: true })).toBe("loading");
  });
});

describe("navigation hiding", () => {
  const v = (role: string, vineyardCountry: string | null): NavViewer => ({
    role, vineyardCountry, isSystemAdmin: false, irrigation: { records: true, reports: true, setup: true }, hasAccountBilling: false,
  });
  const yieldAct = ACTIVITIES.find((a) => a.views.some((x) => x.path === PATH))!;
  const everywhere = (viewer: NavViewer) => [
    accessibleViews(yieldAct, viewer).some((x) => x.path === PATH),
    reportDestinations(viewer).some((d) => d.path === PATH),
    searchDestinations(viewer).some((d) => d.path === PATH),
  ];
  it("shows for AU owner/manager", () => {
    expect(everywhere(v("owner", "Australia"))).toEqual([true, true, true]);
    expect(everywhere(v("manager", "AU"))).toEqual([true, true, true]);
  });
  it.each([["owner", "New Zealand"], ["owner", null], ["manager", "France"], ["supervisor", "Australia"], ["operator", "AU"]])(
    "%s / %s hidden everywhere",
    (role, c) => expect(everywhere(v(role, c))).toEqual([false, false, false]),
  );
});

describe("direct route gate", () => {
  beforeEach(() => {
    ctx.value = { selectedVineyardId: "v1", currentRole: "owner", currentCountry: "Australia", loading: false };
    ctx.dbCountry = "Australia";
  });
  const Child = vi.fn(() => <div>WORKSHEET</div>);
  const ui = (qc: QueryClient) => (
    <QueryClientProvider client={qc}><MemoryRouter><WineGrapeLevyGate><Child /></WineGrapeLevyGate></MemoryRouter></QueryClientProvider>
  );
  const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

  it("mounts the worksheet only for AU owner after the country read", async () => {
    Child.mockClear();
    render(ui(qc()));
    expect(screen.queryByText("WORKSHEET")).toBeNull();
    expect(await screen.findByText("WORKSHEET")).toBeTruthy();
  });

  it("NZ never mounts the worksheet", async () => {
    Child.mockClear();
    ctx.value.currentCountry = "New Zealand"; ctx.dbCountry = "New Zealand";
    render(ui(qc()));
    expect(await screen.findByText(/available only for vineyards located in Australia/)).toBeTruthy();
    expect(Child).not.toHaveBeenCalled();
  });

  it("unknown country shows Vineyard Settings link and no worksheet", async () => {
    Child.mockClear();
    ctx.value.currentCountry = null; ctx.dbCountry = null;
    render(ui(qc()));
    expect(await screen.findByText(/Set the vineyard country under Vineyard Settings/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Vineyard Settings/ }).getAttribute("href")).toBe("/setup/vineyard");
    expect(Child).not.toHaveBeenCalled();
  });

  it("supervisor in AU is blocked", async () => {
    Child.mockClear();
    ctx.value.currentRole = "supervisor";
    render(ui(qc()));
    expect(await screen.findByText("Permission required")).toBeTruthy();
    expect(Child).not.toHaveBeenCalled();
  });

  it("stale AU snapshot is blocked when the fresh read says NZ", async () => {
    Child.mockClear();
    ctx.dbCountry = "New Zealand";
    render(ui(qc()));
    expect(await screen.findByText(/available only for vineyards located in Australia/)).toBeTruthy();
    expect(Child).not.toHaveBeenCalled();
  });

  it("AU → NZ / unknown unmounts immediately; back to AU remounts", async () => {
    const client = qc();
    const r = render(ui(client));
    await screen.findByText("WORKSHEET");
    ctx.value = { ...ctx.value, currentCountry: "NZ" };
    r.rerender(ui(client));
    expect(screen.queryByText("WORKSHEET")).toBeNull();
    ctx.value = { ...ctx.value, currentCountry: "Narnia" };
    r.rerender(ui(client));
    expect(screen.queryByText("WORKSHEET")).toBeNull();
    ctx.value = { ...ctx.value, currentCountry: "Australia" };
    r.rerender(ui(client));
    await waitFor(() => expect(screen.queryByText("WORKSHEET")).toBeTruthy());
  });
});
