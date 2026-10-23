import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { WorkTaskLabourLine } from "@/lib/workTasksQuery";
import { AU_FORMATTERS } from "@/lib/regionFormatters";
import { resolveLocation, ACTIVITIES } from "@/lib/navigationConfig";

const state = vi.hoisted(() => ({ role: "owner", lines: [] as WorkTaskLabourLine[], softDelete: vi.fn(), fetchLines: vi.fn() }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ selectedVineyardId: "v1", currentRole: state.role }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/useRegionFormatters", () => ({ useRegionFormatters: () => AU_FORMATTERS }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/queries", () => ({ fetchList: vi.fn(async () => [{ id: "b1", name: "Shiraz" }]) }));
vi.mock("@/lib/operatorCategoriesQuery", () => ({ fetchOperatorCategoriesForVineyard: vi.fn(async () => ({ categories: [] })) }));
vi.mock("@/lib/workTasksQuery", async (original) => ({
  ...await original<typeof import("@/lib/workTasksQuery")>(),
  fetchLabourLinesForVineyard: state.fetchLines,
  fetchWorkTasksForVineyard: vi.fn(async () => ({ tasks: [{ id: "t1", vineyard_id: "v1", task_type: "Pruning", description: "North rows", paddock_id: "b1", date: "2026-10-23" }] })),
  fetchWorkTasksByIds: vi.fn(async () => []),
  fetchWorkTaskPaddocksForVineyard: vi.fn(async () => [{ id: "j1", vineyard_id: "v1", work_task_id: "t1", paddock_id: "b1" }]),
  softDeleteLabourLine: state.softDelete,
}));

import LabourLinesPage from "@/pages/setup/LabourLinesPage";
import { LabourLineRow } from "@/pages/setup/WorkTasksPage";
import { activeVineyardLabourLines, refreshLabourLineDependents } from "@/lib/labourLineManagement";

const line: WorkTaskLabourLine = { id: "l1", vineyard_id: "v1", work_task_id: "t1", work_date: "2026-10-23", worker_type: "Contract Labour", worker_count: 2, hours_per_worker: 6.5, total_hours: 13, hourly_rate: 35, total_cost: 455, notes: "Correct this entry" };
function mount(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
  return { qc, invalidate };
}
beforeEach(() => {
  state.role = "owner";
  state.lines = [{ ...line }, { ...line, id: "deleted", deleted_at: "2026-10-22", notes: "Deleted record" }, { ...line, id: "other", vineyard_id: "v2", notes: "Other vineyard record" }];
  state.fetchLines.mockReset().mockImplementation(async () => [...state.lines]);
  state.softDelete.mockReset().mockImplementation(async (id: string) => { state.lines = state.lines.filter((l) => l.id !== id); });
});

describe("Labour Lines register", () => {
  it("uses the canonical vineyard fetch and shows only active selected-vineyard rows with parent/block details", async () => {
    mount(<LabourLinesPage />);
    await screen.findByText("Correct this entry");
    await screen.findByText(/Pruning · North rows/);
    expect(state.fetchLines).toHaveBeenCalledWith("v1");
    expect(screen.queryByText("Deleted record")).toBeNull();
    expect(screen.queryByText("Other vineyard record")).toBeNull();
    expect(screen.getByRole("link", { name: "Open Work Task" })).toHaveAttribute("href", "/work-tasks?task=t1");
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "not present" } });
    expect(screen.queryByText("Correct this entry")).toBeNull();
  });
  it.each(["owner", "manager"])("shows rates/costs to %s", async (role) => {
    state.role = role; mount(<LabourLinesPage />);
    await screen.findByText("Correct this entry");
    expect(screen.getByRole("columnheader", { name: "Hourly rate" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Labour cost" })).toBeInTheDocument();
    expect(screen.getByText(AU_FORMATTERS.currency(455))).toBeInTheDocument();
  });
  it.each(["supervisor", "operator"])("hides rates/costs from %s", async (role) => {
    state.role = role; mount(<LabourLinesPage />);
    await screen.findByText("Correct this entry");
    expect(screen.queryByRole("columnheader", { name: "Hourly rate" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Labour cost" })).toBeNull();
    expect(screen.queryByText(AU_FORMATTERS.currency(455))).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete labour line" }) != null).toBe(role === "supervisor");
  });
  it("requires confirmation and Cancel never mutates", async () => {
    mount(<LabourLinesPage />); await screen.findByText("Correct this entry");
    fireEvent.click(screen.getByRole("button", { name: "Delete labour line" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(state.softDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.softDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Correct this entry")).toBeInTheDocument();
  });
  it("Remove soft-deletes the actual row and refreshes canonical labour/effective totals", async () => {
    const { qc, invalidate } = mount(<LabourLinesPage />);
    await screen.findByText("Correct this entry");
    fireEvent.click(screen.getByRole("button", { name: "Delete labour line" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove", exact: true }));
    await waitFor(() => expect(screen.queryByText("Correct this entry")).toBeNull());
    expect(state.softDelete).toHaveBeenCalledExactlyOnceWith("l1", "u1");
    expect(qc.getQueryData<WorkTaskLabourLine[]>(["work_task_labour_lines", "v1"])?.some((l) => l.id === "l1")).toBe(false);
    for (const key of [["work_task_labour_lines", "v1"], ["work-task-effective-labour-cost", "v1"], ["work_tasks", "v1"], ["cost-report-work-task-sources", "v1"]]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    }
    expect(state.fetchLines.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("Existing Work Task labour row", () => {
  it("requires confirmation and reports a local tombstone after removal", async () => {
    const changed = vi.fn();
    mount(<LabourLineRow line={line} categories={[]} canSoftDelete userId="u1" vineyardId="v1" taskId="t1" onChanged={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete labour line" }));
    expect(state.softDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.softDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete labour line" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove", exact: true }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(changed.mock.calls[0][0]).toMatchObject({ id: "l1", deleted_at: expect.any(String) });
    expect(state.softDelete).toHaveBeenCalledExactlyOnceWith("l1", "u1");
  });
});

it("refreshes an active effective-cost observer rather than leaving stale costs", async () => {
  const fetchCost = vi.fn(async () => state.lines.some((l) => l.id === "l1") ? 455 : 0);
  function Cost() {
    const q = useQuery({ queryKey: ["work-task-effective-labour-cost", "v1"], queryFn: fetchCost });
    return <output aria-label="Parent labour cost">{q.data}</output>;
  }
  const { qc } = mount(<Cost />);
  await waitFor(() => expect(screen.getByLabelText("Parent labour cost")).toHaveTextContent("455"));
  state.lines = [];
  await refreshLabourLineDependents(qc, "v1", "l1");
  await waitFor(() => expect(screen.getByLabelText("Parent labour cost")).toHaveTextContent("0"));
  expect(fetchCost).toHaveBeenCalledTimes(2);
});

it("resolves Labour Lines as a child of Work Tasks between Tasks and Reports", () => {
  const resolved = resolveLocation("/work-tasks/labour-lines");
  expect(resolved.activity?.id).toBe("work-tasks");
  expect(resolved.view?.id).toBe("work-tasks.labour-lines");
  expect(ACTIVITIES.find((a) => a.id === "work-tasks")?.views.map((v) => v.path)).toEqual(["/work-tasks", "/work-tasks/labour-lines", "/reports/work-tasks"]);
  expect(activeVineyardLabourLines(state.lines, "v1").some((l) => l.deleted_at || l.vineyard_id !== "v1")).toBe(false);
});