import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VineyardProvider, useVineyard } from "@/context/VineyardContext";

const mocks = vi.hoisted(() => ({ rows: [] as any[], is: vi.fn(), eq: vi.fn() }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin" } }) }));
vi.mock("@/lib/dateFormat", () => ({ setDateLocaleFromCountry: vi.fn() }));
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: mocks.eq }) }) },
}));

function Probe() {
  const { memberships, selectedVineyardId, loading } = useVineyard();
  return <div>{loading ? "loading" : `ready:${memberships.map(m => m.vineyard_id).join(",")}:${selectedVineyardId ?? "none"}`}</div>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><VineyardProvider><Probe /></VineyardProvider></QueryClientProvider>);
  return client;
}
describe("vineyard membership visibility", () => {
  beforeEach(() => {
    cleanup(); localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
    mocks.eq.mockReturnValue({ is: mocks.is });
    mocks.is.mockImplementation(async () => ({ data: mocks.rows, error: null }));
    mocks.rows = [];
  });
  it("excludes deleted and missing vineyard parents and keeps real active memberships", async () => {
    mocks.rows = [
      { vineyard_id: "active", role: "owner", vineyards: { name: "Real", country: "Australia", deleted_at: null } },
      { vineyard_id: "deleted-demo", role: "owner", vineyards: { name: "Demo", deleted_at: "2026-10-24" } },
      { vineyard_id: "missing-demo", role: "owner", vineyards: null },
    ];
    mount();
    await waitFor(() => expect(screen.getByText("ready:active:active")).toBeInTheDocument());
    expect(mocks.eq).toHaveBeenCalledWith("user_id", "admin");
    expect(mocks.is).toHaveBeenCalledWith("vineyards.deleted_at", null);
  });
  it("keeps a stored selection while memberships are still loading", async () => {
    localStorage.setItem("vt_selected_vineyard", "my-vineyard");
    mocks.is.mockReturnValue(new Promise(() => {})); // query never resolves
    mount();
    await waitFor(() => expect(screen.getByText("loading")).toBeInTheDocument());
    expect(localStorage.getItem("vt_selected_vineyard")).toBe("my-vineyard");
  });
  it("restores a stored selection for a multi-vineyard user after load", async () => {
    localStorage.setItem("vt_selected_vineyard", "second");
    mocks.rows = [
      { vineyard_id: "first", role: "owner", vineyards: { name: "First", deleted_at: null } },
      { vineyard_id: "second", role: "manager", vineyards: { name: "Second", deleted_at: null } },
    ];
    mount();
    await waitFor(() => expect(screen.getByText("ready:first,second:second")).toBeInTheDocument());
    expect(localStorage.getItem("vt_selected_vineyard")).toBe("second");
  });
  it("clears a removed selection even when no memberships remain", async () => {
    localStorage.setItem("vt_selected_vineyard", "deleted-demo");
    mount();
    await waitFor(() => expect(screen.getByText("ready::none")).toBeInTheDocument());
    expect(localStorage.getItem("vt_selected_vineyard")).toBeNull();
  });
  it("refreshes the list after membership invalidation", async () => {
    mocks.rows = [{ vineyard_id: "demo", role: "owner", vineyards: { name: "Demo", deleted_at: null } }];
    const client = mount();
    await waitFor(() => expect(screen.getByText("ready:demo:demo")).toBeInTheDocument());
    mocks.rows = [];
    await client.invalidateQueries({ queryKey: ["memberships"] });
    await waitFor(() => expect(screen.getByText("ready::none")).toBeInTheDocument());
  });
});