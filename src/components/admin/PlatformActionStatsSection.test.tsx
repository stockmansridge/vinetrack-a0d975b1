import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { PlatformActionStatsSection } from "./PlatformActionStatsSection";
vi.mock("@/integrations/ios-supabase/client", () => ({ iosSupabase: { rpc: vi.fn(async () => ({ data: [{ action_key: "trips", label: "Trips", category: "Operations", created_count: 3, edited_count: 0, deleted_count: 0, vineyard_count: 1, user_count: 1 }], error: null })) } }));
// Soil activity has its own read helper; this file covers SQL 257 attribution only.
vi.mock("@/lib/soilPlatformActivity", () => ({ loadSoilActivityStats: vi.fn(async () => []) }));

vi.mock("@/lib/adminActionParticipants", () => ({ fetchActionParticipants: vi.fn(async (_a, kind) => [{ id: kind === "users" ? "u" : "v", records: 3 }]) }));
vi.mock("@/lib/adminApi", () => ({
  useAdminUsers: () => ({ data: [{ id: "u", full_name: "Fixture User", email: "fixture@example.invalid" }] }),
  useAdminVineyards: () => ({ data: [{ id: "v", name: "Fixture Vineyard" }] }),
}));
afterEach(cleanup);
it("opens each counted participant list and links to its existing admin detail", async () => {
  render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PlatformActionStatsSection /></QueryClientProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Trips: 1 vineyards" }));
  expect((await screen.findByRole("link", { name: "Fixture Vineyard" })).getAttribute("href")).toBe("/admin/vineyards/v");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Trips: 1 users" }));
  expect((await screen.findByRole("link", { name: "Fixture User" })).getAttribute("href")).toBe("/admin/users/u");
});