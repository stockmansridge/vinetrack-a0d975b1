import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
}));

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: state.user, loading: false }) }));
// If anything starts gating on admin/demo again these mocks would make it obvious.
vi.mock("@/lib/systemAdmin", () => ({
  useIsSystemAdmin: () => ({ isAdmin: false, loading: false }),
  useIsSystemAdminRaw: () => ({ isAdmin: false, loading: false }),
}));
vi.mock("@/context/DemoModeContext", () => ({ useDemoMode: () => ({ demoMode: true, setDemoMode: () => {} }) }));

import { BrightIconsProvider, useBrightIcons } from "@/context/BrightIconsContext";
import { MetricCard } from "@/components/ui/metric-card";
import { brightPrefKey, resolveBrightIcons, BRIGHT_BADGE_CLASSES } from "@/lib/brightIcons";
import { Grape } from "lucide-react";

let api: ReturnType<typeof useBrightIcons>;
function Probe() {
  api = useBrightIcons();
  return <MetricCard label="Vines" value={1} icon={Grape} tone="primary" />;
}
const ui = () => (
  <MemoryRouter>
    <BrightIconsProvider>
      <Probe />
    </BrightIconsProvider>
  </MemoryRouter>
);
const badge = (c: HTMLElement) => c.querySelector("[data-icon-badge]")!.className;
const brightStop = BRIGHT_BADGE_CLASSES.growth.split(" ")[1];

beforeEach(() => {
  localStorage.clear();
  state.user = { id: "user-1" };
});

describe("Brighter icons (all users)", () => {
  it("is off by default and ignores a legacy v1 admin preview bit", () => {
    localStorage.setItem("vt.brightIcons.v1:user-1", "1");
    const { container } = render(ui());
    expect(brightPrefKey("user-1")).toBe("vt.brightIcons.v2:user-1");
    expect(api.bright).toBe(false);
    expect(api.prefOn).toBe(false);
    expect(badge(container)).toContain("bg-primary/10");
  });

  it.each(["owner", "manager", "supervisor", "employee", "operator"])(
    "a signed-in %s (not System Admin) can use the toggle",
    (role) => {
      state.user = { id: `u-${role}` };
      render(ui());
      expect(api.canToggle).toBe(true);
    },
  );

  it("opt-in applies the bright style immediately, persists, and opt-out restores normal", () => {
    const { container, unmount } = render(ui());
    act(() => api.setPrefOn(true));
    expect(api.bright).toBe(true);
    expect(badge(container)).toContain(brightStop);
    expect(badge(container)).toContain("text-white");
    expect(localStorage.getItem(brightPrefKey("user-1"))).toBe("1");
    unmount();
    const r = render(ui());
    expect(api.bright).toBe(true);
    act(() => api.setPrefOn(false));
    expect(api.bright).toBe(false);
    expect(badge(r.container)).toContain("bg-primary/10");
    expect(localStorage.getItem(brightPrefKey("user-1"))).toBeNull();
  });

  it("works in Demo Mode (demo mocked on throughout)", () => {
    render(ui());
    act(() => api.setPrefOn(true));
    expect(api.bright).toBe(true);
  });

  it("isolates users and hides/turns off when signed out", () => {
    localStorage.setItem(brightPrefKey("user-1"), "1");
    const { rerender } = render(ui());
    expect(api.bright).toBe(true);
    state.user = { id: "user-2" };
    rerender(ui());
    expect(api.bright).toBe(false);
    state.user = null;
    rerender(ui());
    expect(api.bright).toBe(false);
    expect(api.canToggle).toBe(false);
    expect(resolveBrightIcons({ signedIn: false, prefOn: true })).toBe(false);
  });

  it("uses normal icons when no provider is mounted", () => {
    const { container } = render(
      <MemoryRouter>
        <MetricCard label="Vines" value={1} icon={Grape} tone="equipment" />
      </MemoryRouter>,
    );
    expect(badge(container)).toContain("bg-amber-100");
  });
});
