import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AU_FORMATTERS } from "@/lib/regionFormatters";
import type { WorkTaskLabourLine, WorkTaskMachineLine } from "@/lib/workTasksQuery";

vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ selectedVineyardId: "v1", currentRole: "owner" }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/useRegionFormatters", () => ({ useRegionFormatters: () => AU_FORMATTERS }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/queries", () => ({ fetchList: vi.fn(async () => []) }));
vi.mock("@/lib/operatorCategoriesQuery", () => ({ fetchOperatorCategoriesForVineyard: vi.fn(async () => ({ categories: [] })) }));

import { LabourLineRow, formFromLine } from "@/pages/setup/WorkTasksPage";

// 2026-10-23T21:00Z is 2026-10-24 08:00 in Australia/Sydney (UTC+11), so the
// vineyard-local calendar day differs from the UTC calendar day.
const SYDNEY = "Australia/Sydney";
const UTC_DAY = "2026-10-23";
const SYDNEY_DAY = "2026-10-24";

function mount(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

function dateInputValue(): string | null {
  const input = document.querySelector('input[type="date"]') as HTMLInputElement | null;
  return input?.value ?? null;
}

const savedLine: WorkTaskLabourLine = {
  id: "l1", vineyard_id: "v1", work_task_id: "t1", work_date: "2026-09-03",
  worker_type: "Contract Labour", worker_count: 2, hours_per_worker: 6.5,
  total_hours: 13, hourly_rate: 35, total_cost: 455, notes: "",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T21:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("New labour line default work date", () => {
  it("defaults to the vineyard-local day, not the UTC day", () => {
    mount(<LabourLineRow line={null} categories={[]} canSoftDelete userId="u1" vineyardId="v1" taskId="t1" onChanged={() => {}} timeZone={SYDNEY} />);
    expect(dateInputValue()).toBe(SYDNEY_DAY);
    expect(dateInputValue()).not.toBe(UTC_DAY);
  });

  it("keeps the saved date of an existing line", () => {
    mount(<LabourLineRow line={savedLine} categories={[]} canSoftDelete userId="u1" vineyardId="v1" taskId="t1" onChanged={() => {}} timeZone={SYDNEY} />);
    expect(dateInputValue()).toBe("2026-09-03");
  });
});

describe("Machine line default work date", () => {
  it("fills an unsaved work date with the vineyard-local day", () => {
    const machineLine = { id: "m1", work_date: null } as WorkTaskMachineLine;
    expect(formFromLine(machineLine, undefined, SYDNEY).work_date).toBe(SYDNEY_DAY);
    expect(formFromLine(machineLine).work_date).not.toBe("1970-01-01");
  });

  it("keeps the saved date of an existing machine line", () => {
    const machineLine = { id: "m1", work_date: "2026-08-01" } as WorkTaskMachineLine;
    expect(formFromLine(machineLine, undefined, SYDNEY).work_date).toBe("2026-08-01");
  });
});
