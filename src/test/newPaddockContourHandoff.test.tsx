// New Block wizard → System Admin Contour Row Mapping (Beta) handoff.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  admin: { isAdmin: true, loading: false },
  vineyard: "v1",
  user: "u1",
  insert: vi.fn(),
}));

vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => h.admin }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: h.user } }) }));
vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({ selectedVineyardId: h.vineyard, currentRole: "owner", memberships: [] }),
}));
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { from: () => ({ insert: h.insert }) },
}));
vi.mock("@/components/varieties/VarietyAllocationEditor", () => ({
  default: () => null,
  isAllocationsValid: () => true,
  serialiseAllocations: () => [],
}));
vi.mock("@/components/paddocks/BoundaryDrawMap", () => ({
  default: ({ setPolygon, readonly }: any) =>
    readonly ? null : (
      <button
        onClick={() =>
          setPolygon([
            { lat: -34.0, lng: 138.0 },
            { lat: -34.0, lng: 138.002 },
            { lat: -34.002, lng: 138.002 },
            { lat: -34.002, lng: 138.0 },
          ])
        }
      >
        draw
      </button>
    ),
}));

import NewPaddockPage from "@/pages/setup/NewPaddockPage";

let loc = "";
function Loc() { loc = useLocation().pathname; return null; }

function renderPage() {
  const qc = new QueryClient();
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/setup/paddocks/new"]}>
        <Loc />
        <Routes>
          <Route path="/setup/paddocks/new" element={<NewPaddockPage />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, rerenderPage: () => utils.rerender(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/setup/paddocks/new"]}>
        <Loc />
        <Routes>
          <Route path="/setup/paddocks/new" element={<NewPaddockPage />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ) };
}

const goStep = (re: RegExp) => fireEvent.click(screen.getAllByRole("button", { name: re })[0]);
const toggle = () => screen.queryByLabelText(/Open Contour Row Mapping/i) as HTMLInputElement | null;

function toRows() {
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Contour Test" } });
  goStep(/^2\./);
  fireEvent.click(screen.getByText("draw"));
  goStep(/^3\./);
}

beforeEach(() => {
  h.admin = { isAdmin: true, loading: false };
  h.vineyard = "v1";
  h.user = "u1";
  h.insert.mockReset().mockResolvedValue({ error: null });
  loc = "";
});

describe("New Block contour handoff", () => {
  it("admin option persists through steps and labels the save action", () => {
    renderPage(); toRows();
    fireEvent.click(toggle()!);
    goStep(/^4\./); goStep(/^3\./);
    expect(toggle()!.checked).toBe(true);
    goStep(/^8\./);
    expect(screen.getByRole("button", { name: "Save block & open contour mapping" })).toBeTruthy();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("hidden for non-admins and while admin status is loading", () => {
    h.admin = { isAdmin: false, loading: false };
    const { unmount } = renderPage(); toRows();
    expect(toggle()).toBeNull();
    unmount();
    h.admin = { isAdmin: true, loading: true };
    renderPage(); toRows();
    expect(toggle()).toBeNull();
  });

  it("routes to the inserted id's contour editor", async () => {
    renderPage(); toRows(); fireEvent.click(toggle()!); goStep(/^8\./);
    fireEvent.click(screen.getByRole("button", { name: /open contour mapping/ }));
    await waitFor(() => expect(loc).toMatch(/\/contour-rows$/));
    const id = h.insert.mock.calls[0][0].id;
    expect(loc).toBe(`/setup/paddocks/${id}/contour-rows`);
  });

  it("normal save keeps list destination", async () => {
    renderPage(); toRows(); goStep(/^8\./);
    fireEvent.click(screen.getByRole("button", { name: "Save block" }));
    await waitFor(() => expect(loc).toBe("/setup/paddocks"));
  });

  it("failed insert keeps form and choice, no navigation", async () => {
    h.insert.mockResolvedValue({ error: { message: "boom" } });
    renderPage(); toRows(); fireEvent.click(toggle()!); goStep(/^8\./);
    fireEvent.click(screen.getByRole("button", { name: /open contour mapping/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /open contour mapping/ })).toBeTruthy());
    expect(loc).toBe("/setup/paddocks/new");
    goStep(/^1\./);
    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe("Contour Test");
  });

  it("double submit inserts once", async () => {
    let resolve!: (v: any) => void;
    h.insert.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage(); toRows(); goStep(/^8\./);
    const btn = screen.getByRole("button", { name: "Save block" });
    fireEvent.click(btn); fireEvent.click(btn);
    expect(h.insert).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ error: null }));
  });

  it("vineyard change mid-save does not open contour editor", async () => {
    let resolve!: (v: any) => void;
    h.insert.mockReturnValue(new Promise((r) => (resolve = r)));
    const { rerenderPage } = renderPage(); toRows(); fireEvent.click(toggle()!); goStep(/^8\./);
    fireEvent.click(screen.getByRole("button", { name: /open contour mapping/ }));
    h.vineyard = "v2";
    rerenderPage();
    await act(async () => resolve({ error: null }));
    await waitFor(() => expect(loc).toBe("/setup/paddocks"));
  });

  it("choice does not carry to another account", () => {
    const { rerenderPage } = renderPage(); toRows(); fireEvent.click(toggle()!);
    h.user = "u2"; rerenderPage();
    expect(toggle()!.checked).toBe(false);
  });
});
