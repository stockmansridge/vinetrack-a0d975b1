import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AppReleasesPage from "@/pages/admin/AppReleasesPage";
import { listAppReleasePolicies, releaseForm, releaseValidation, raisesMinimum, saveAppReleasePolicy,
  type AppReleasePolicy } from "@/lib/appReleases";
import { searchDestinations, type NavViewer } from "@/lib/navigationConfig";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), success: vi.fn(), access: { isAdmin: true, loading: false }, user: { id: "admin-a" } as { id: string } | null }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => mocks.access }));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));

const ios: AppReleasePolicy = { platform: "ios", latest_version: "3.2.0", latest_build: 238,
  minimum_supported_version: "3.1.0", minimum_supported_build: 230, update_title: "Update available",
  update_message: "A new release", store_url: "https://apps.apple.com/app/example", active: true, updated_at: "2026-11-07T07:00:00Z" };
const android: AppReleasePolicy = { ...ios, platform: "android", latest_build: 1794000017, minimum_supported_build: 1794000000, store_url: "https://play.google.com/store/apps/details?id=example" };
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
  return { ...render(<AppReleasesPage />, { wrapper }), qc };
}
async function editIOS() {
  await screen.findAllByRole("button", { name: "Edit" });
  fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
  fireEvent.change(screen.getByLabelText("Reason for change (required)"), { target: { value: "Release verified in store" } });
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.clearAllMocks(); mocks.access = { isAdmin: true, loading: false }; mocks.user = { id: "admin-a" };
  mocks.rpc.mockImplementation(async (name: string) => name === "admin_list_app_release_policies" ? { data: [ios, android], error: null } : { data: ios, error: null });
});

describe("App release validation rules", () => {
  it.each(["", "-1", "1.5", "1e3", "Infinity", "9007199254740992"])("rejects invalid latest build %s", value => {
    const form = { ...releaseForm(ios), reason: "Verified", latest_build: value };
    expect(releaseValidation(form).length).toBeGreaterThan(0);
  });
  it.each(["", "-1", "2.2"])("rejects invalid minimum build %s", value => {
    expect(releaseValidation({ ...releaseForm(ios), reason: "Verified", minimum_supported_build: value }).length).toBeGreaterThan(0);
  });
  it("accepts zero builds", () => {
    expect(releaseValidation({ ...releaseForm(ios), reason: "Verified", latest_build: "0", minimum_supported_build: "0" })).toEqual([]);
  });
  it("rejects minimum above latest and accepts equality", () => {
    const form = { ...releaseForm(ios), reason: "Verified", minimum_supported_build: "239" };
    expect(releaseValidation(form).length).toBeGreaterThan(0);
    expect(releaseValidation({ ...form, minimum_supported_build: "238" })).toEqual([]);
  });
  it("limits title to 100 characters", () => {
    const form = { ...releaseForm(ios), reason: "Verified", update_title: "a".repeat(100) };
    expect(releaseValidation(form)).toEqual([]);
    expect(releaseValidation({ ...form, update_title: "a".repeat(101) }).length).toBeGreaterThan(0);
  });
  it("limits message to 800 characters", () => {
    const form = { ...releaseForm(ios), reason: "Verified", update_message: "a".repeat(800) };
    expect(releaseValidation(form)).toEqual([]);
    expect(releaseValidation({ ...form, update_message: "a".repeat(801) }).length).toBeGreaterThan(0);
  });
  it("requires nonblank reason; title and message are optional", () => {
    expect(releaseValidation({ ...releaseForm(ios), reason: "  " }).length).toBeGreaterThan(0);
    expect(releaseValidation({ ...releaseForm(ios), reason: "Verified", update_title: "", update_message: "" })).toEqual([]);
  });
  it("requires acknowledgement only for raised minimum", () => {
    expect(raisesMinimum(ios, { ...releaseForm(ios), minimum_supported_build: "231" })).toBe(true);
    expect(raisesMinimum(ios, releaseForm(ios))).toBe(false);
    expect(raisesMinimum(ios, { ...releaseForm(ios), minimum_supported_build: "229" })).toBe(false);
  });
});

describe("App release RPC contracts", () => {
  it("reads only via list RPC", async () => {
    expect(await listAppReleasePolicies()).toEqual([ios, android]);
    expect(mocks.rpc).toHaveBeenCalledWith("admin_list_app_release_policies");
  });
  it("sends exactly the approved save arguments and never store URL", async () => {
    await saveAppReleasePolicy("ios", { ...releaseForm(ios), reason: " Verified release " });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_set_app_release_policy", {
      p_platform: "ios", p_latest_version: "3.2.0", p_latest_build: 238,
      p_minimum_supported_version: "3.1.0", p_minimum_supported_build: 230,
      p_update_title: "Update available", p_update_message: "A new release", p_active: true, p_reason: "Verified release",
    });
  });
  it("rejects invalid form without an RPC", async () => {
    await expect(saveAppReleasePolicy("ios", releaseForm(ios))).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("propagates the exact server error", async () => {
    const error = { message: "Minimum supported build cannot be above the latest build" };
    mocks.rpc.mockResolvedValue({ data: null, error });
    await expect(saveAppReleasePolicy("ios", { ...releaseForm(ios), reason: "Verified" })).rejects.toEqual(error);
  });
  it("does not accept an absent saved row as success", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(saveAppReleasePolicy("ios", { ...releaseForm(ios), reason: "Verified" })).rejects.toThrow();
  });
});

describe("App Releases access and confirmation", () => {
  it.each([{ isAdmin: false, loading: false }, { isAdmin: false, loading: true }, { isAdmin: true, loading: true }])("never reads policies before verified admin access (%j)", access => {
    mocks.access = access;
    mount();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "App Releases" })).not.toBeInTheDocument();
  });
  it("hides the destination from customer navigation search", () => {
    const viewer: NavViewer = { role: "owner", isSystemAdmin: false, irrigation: { records: false, reports: false, setup: false }, hasAccountBilling: false };
    expect(searchDestinations(viewer).map(x => x.path)).not.toContain("/admin/app-releases");
    expect(searchDestinations({ ...viewer, isSystemAdmin: true }).map(x => x.path)).toContain("/admin/app-releases");
  });
  it("requires reason and confirmation before any save", async () => {
    mount(); await screen.findAllByRole("button", { name: "Edit" });
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for change (required)"), { target: { value: "Live in store" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.rpc.mock.calls.filter(x => x[0] === "admin_set_app_release_policy")).toHaveLength(0);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it("cannot confirm a raised minimum until acknowledged, then saves and refreshes", async () => {
    mount(); await editIOS();
    fireEvent.change(screen.getByLabelText("Minimum supported build"), { target: { value: "231" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Confirm change" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    expect(mocks.rpc.mock.calls.filter(x => x[0] === "admin_list_app_release_policies")).toHaveLength(2);
    expect(mocks.rpc.mock.calls.find(x => x[0] === "admin_set_app_release_policy")?.[1].p_minimum_supported_build).toBe(231);
  });
  it("inactive change still requires confirmation and sends false", async () => {
    mount(); await editIOS(); fireEvent.click(screen.getByRole("switch", { name: "Active" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("checkbox", { name: "I understand" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.rpc.mock.calls.find(x => x[0] === "admin_set_app_release_policy")?.[1].p_active).toBe(false);
  });
  it("shows server error as-is with no success or refresh", async () => {
    mocks.rpc.mockImplementation(async name => name === "admin_list_app_release_policies" ? { data: [ios, android], error: null } : { data: null, error: { message: "A reason is required" } });
    mount(); await editIOS(); fireEvent.click(screen.getByRole("button", { name: "Save" })); fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^A reason is required$/);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.filter(x => x[0] === "admin_list_app_release_policies")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("blocks repeated submit while saving", async () => {
    mocks.rpc.mockImplementation(name => name === "admin_list_app_release_policies" ? Promise.resolve({ data: [ios, android], error: null }) : new Promise(() => {}));
    mount(); await editIOS(); fireEvent.click(screen.getByRole("button", { name: "Save" })); fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled());
    expect(mocks.rpc.mock.calls.filter(x => x[0] === "admin_set_app_release_policy")).toHaveLength(1);
  });
});