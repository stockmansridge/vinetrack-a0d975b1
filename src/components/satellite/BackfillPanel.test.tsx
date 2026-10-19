import { render, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import BackfillPanel from "./BackfillPanel";
const api = vi.hoisted(() => ({ status: vi.fn(), run: vi.fn(), discover: vi.fn() }));
vi.mock("@/lib/satelliteBackfill", () => ({ fetchBackfillStatus: api.status, runBackfillBatch: api.run,
  discoverBackfill: api.discover, isBackfillActive: (status: any) => status?.active_job?.status === "processing" }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it.each([true, false])("mounting History/Admin (manage=%s) with an old job never starts provider/discovery/batch calls", async (canManage) => {
  api.status.mockResolvedValue({ active_job: { status: "processing", current_processing_date: "2026-08-02" }, expected_date_total: 0 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const panel = render(<QueryClientProvider client={client}><BackfillPanel vineyardId="fixture" paddockIds={["p1"]} canManage={canManage} /></QueryClientProvider>);
  await waitFor(() => expect(api.status).toHaveBeenCalled());
  await waitFor(() => expect(document.body.textContent).toContain("not resumed by this page"));
  expect(api.run).not.toHaveBeenCalled(); expect(api.discover).not.toHaveBeenCalled();
  panel.unmount();
  render(<QueryClientProvider client={client}><BackfillPanel vineyardId="fixture" paddockIds={["p1"]} canManage={canManage} /></QueryClientProvider>);
  await waitFor(() => expect(document.body.textContent).toContain("not resumed by this page"));
  expect(api.run).not.toHaveBeenCalled(); expect(api.discover).not.toHaveBeenCalled(); client.clear();
});