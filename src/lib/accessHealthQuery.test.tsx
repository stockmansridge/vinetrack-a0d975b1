import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { adminRpc } from "@/lib/accessEntitlementsQuery";
import { useAccessHealth } from "./accessHealthQuery";

vi.mock("@/lib/accessEntitlementsQuery", () => ({
  AE_KEYS: { root: ["admin", "access-entitlements"] },
  adminRpc: vi.fn(),
}));
const rpc = vi.mocked(adminRpc);
let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => client.clear());

describe("useAccessHealth", () => {
  it("uses the admin RPC and participates in the page's global refresh", async () => {
    rpc.mockResolvedValue({
      generated_at: "2026-10-21T10:02:00Z",
      rollout: { is_enabled: true, cohort: "all", configuration_valid: true },
      scheduler: { active: true, last_success_at: null, overdue: false },
      latest_scan: null, open_issue_count: 0,
    });
    const { result } = renderHook(() => useAccessHealth(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith("admin_access_health");
    await client.invalidateQueries({ queryKey: ["admin", "access-entitlements"] });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(result.current.data?.latest_scan).toBeNull();
  });

  it.each(["malformed", "denied"])("exposes %s responses as errors, without retrying", async (response) => {
    if (response === "denied") rpc.mockRejectedValue({ code: "42501", message: "System Admin required" });
    else rpc.mockResolvedValue({ open_issue_count: 0 });
    const { result } = renderHook(() => useAccessHealth(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(rpc).toHaveBeenCalledOnce();
  });
});
