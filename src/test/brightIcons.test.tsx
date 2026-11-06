import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  user: { id: "admin-1" } as { id: string } | null,
  admin: { isAdmin: true, loading: false },
  raw: { isAdmin: true, loading: false },
  demo: false,
  setDemo: (v: boolean) => { state.demo = v; },
}));

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: state.user, loading: false }) }));
vi.mock("@/lib/systemAdmin", () => ({
  useIsSystemAdmin: () => (state.demo ? { ...state.raw, isAdmin: false } : state.admin),
  useIsSystemAdminRaw: () => state.raw,
}));
vi.mock("@/context/DemoModeContext", () => ({
  useDemoMode: () => ({ demoMode: state.demo, setDemoMode: (v: boolean) => state.setDemo(v) }),
}));

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

beforeEach(() => {
  localStorage.clear();
  state.user = { id: "admin-1" };
  state.admin = { isAdmin: true, loading: false };
  state.raw = { isAdmin: true, loading: false };
  state.demo = false;
});

describe("Brighter icons preview", () => {
  it("defaults OFF with the existing style, even for a System Admin", () => {
    const { container } = render(ui());
    expect(api.bright).toBe(false);
    expect(api.canPreview).toBe(true);
    expect(badge(container)).toContain("bg-primary/10");
  });

  it("applies the gradient style when an admin turns it on, and persists per user", () => {
    const { container, unmount } = render(ui());
    act(() => api.setPrefOn(true));
    expect(api.bright).toBe(true);
    expect(badge(container)).toContain(BRIGHT_BADGE_CLASSES.growth.split(" ")[1]);
    expect(badge(container)).toContain("text-white");
    expect(localStorage.getItem(brightPrefKey("admin-1"))).toBe("1");
    unmount();
    render(ui());
    expect(api.bright).toBe(true);
  });

  it("never activates for non-admins even with a stored bit", () => {
    localStorage.setItem(brightPrefKey("admin-1"), "1");
    state.admin = { isAdmin: false, loading: false };
    state.raw = { isAdmin: false, loading: false };
    const { container } = render(ui());
    expect(api.bright).toBe(false);
    expect(api.canPreview).toBe(false);
    expect(badge(container)).toContain("bg-primary/10");
  });

  it("fails closed while the admin check is loading (and when demo mode reports not-admin)", () => {
    localStorage.setItem(brightPrefKey("admin-1"), "1");
    state.admin = { isAdmin: true, loading: true };
    state.raw = { isAdmin: true, loading: true };
    render(ui());
    expect(api.bright).toBe(false);
    expect(api.canPreview).toBe(false);
    expect(resolveBrightIcons({ isSystemAdmin: false, adminLoading: false, prefOn: true })).toBe(false);
  });

  it("does not carry one user's preference to another account or after sign-out", () => {
    localStorage.setItem(brightPrefKey("admin-1"), "1");
    const { rerender } = render(ui());
    expect(api.bright).toBe(true);
    state.user = { id: "admin-2" };
    rerender(ui());
    expect(api.bright).toBe(false);
    state.user = null;
    rerender(ui());
    expect(api.bright).toBe(false);
  });

  it("uses normal icons when no provider is mounted", () => {
    const { container } = render(
      <MemoryRouter>
        <MetricCard label="Vines" value={1} icon={Grape} tone="equipment" />
      </MemoryRouter>,
    );
    expect(badge(container)).toContain("bg-amber-100");
  });

  it("raw admin in Demo Mode: option visible but blocked, styling off, saved pref untouched", () => {
    localStorage.setItem(brightPrefKey("admin-1"), "1");
    state.demo = true;
    const { container, rerender } = render(ui());
    expect(api.canPreview).toBe(true);
    expect(api.blockedByDemo).toBe(true);
    expect(api.bright).toBe(false);
    expect(badge(container)).toContain("bg-primary/10");
    act(() => api.setPrefOn(false));
    expect(localStorage.getItem(brightPrefKey("admin-1"))).toBe("1");
    act(() => api.exitDemoMode());
    expect(state.demo).toBe(false);
    rerender(ui());
    expect(api.blockedByDemo).toBe(false);
    expect(api.bright).toBe(true);
    expect(badge(container)).toContain("text-white");
  });

  it("Demo Mode does not let a non-admin see the option", () => {
    state.demo = true;
    state.raw = { isAdmin: false, loading: false };
    render(ui());
    expect(api.canPreview).toBe(false);
    expect(api.blockedByDemo).toBe(false);
  });
});
