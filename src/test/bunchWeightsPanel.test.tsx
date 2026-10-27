// Bunch Weights tab roll-up behaviour: every variety's master and block
// values are visible when the tab opens, with an Expand all / Collapse all
// control and per-variety chevrons that still work independently.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BunchWeightsPanel, {
  type BunchWeightBlock,
} from "@/components/yield/BunchWeightsPanel";
import type { YieldBunchWeightRow } from "@/lib/yieldBunchWeights";

vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const rows: YieldBunchWeightRow[] = [
  { id: "m1", vineyard_id: "v1", paddock_id: null, variety_key: "shiraz", variety_name: "Shiraz", bunch_weight_grams: 200, updated_at: null },
  { id: "b1", vineyard_id: "v1", paddock_id: "p1", variety_key: "shiraz", variety_name: "Shiraz", bunch_weight_grams: 250, updated_at: null },
  { id: "m2", vineyard_id: "v1", paddock_id: null, variety_key: "riesling", variety_name: "Riesling", bunch_weight_grams: 150, updated_at: null },
];

const blocks: BunchWeightBlock[] = [
  { id: "p1", name: "Block A", plantings: [{ key: "shiraz", name: "Shiraz", percent: 100, legacyKey: false }] },
  { id: "p2", name: "Block B", plantings: [{ key: "shiraz", name: "Shiraz", percent: 100, legacyKey: false }] },
  { id: "p3", name: "Block C", plantings: [{ key: "riesling", name: "Riesling", percent: 100, legacyKey: false }] },
];

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <BunchWeightsPanel vineyardId="v1" role="owner" blocks={blocks} rows={rows} />
    </QueryClientProvider>,
  );
}

const shirazRow = () => screen.getByTestId("variety-row-shiraz");

describe("Bunch Weights roll-up", () => {
  it("shows every variety's master and block values as soon as the tab opens", () => {
    mount();
    // Master values and block rows are all present without any interaction.
    expect(within(shirazRow()).getByText("200 g")).toBeInTheDocument();
    expect(screen.getByText("Block A")).toBeInTheDocument();
    expect(screen.getByText("Block B")).toBeInTheDocument();
    expect(screen.getByText("Block C")).toBeInTheDocument();
    expect(within(shirazRow().parentElement as HTMLElement).getByText("250 g")).toBeInTheDocument();
    expect(within(screen.getByTestId("variety-row-riesling")).getByText("150 g")).toBeInTheDocument();
  });

  it("collapses everything with the header button and expands it all again", () => {
    mount();
    const expandAll = screen.getByTestId("bunch-weights-expand-all");
    expect(expandAll).toHaveTextContent("Collapse all");

    fireEvent.click(expandAll);
    expect(expandAll).toHaveTextContent("Expand all");
    expect(screen.queryByText("Block A")).toBeNull();
    expect(screen.queryByText("Block C")).toBeNull();
    // The rolled-up master values stay visible while collapsed.
    expect(within(shirazRow()).getByText("200 g")).toBeInTheDocument();

    fireEvent.click(expandAll);
    expect(expandAll).toHaveTextContent("Collapse all");
    expect(screen.getByText("Block A")).toBeInTheDocument();
    expect(screen.getByText("Block B")).toBeInTheDocument();
    expect(screen.getByText("Block C")).toBeInTheDocument();
  });

  it("keeps per-variety chevrons independent of the expand-all state", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Shiraz blocks" }));
    expect(screen.queryByText("Block A")).toBeNull();
    expect(screen.queryByText("Block B")).toBeNull();
    // Riesling's blocks remain visible.
    expect(screen.getByText("Block C")).toBeInTheDocument();

    // Expand all brings every section back, including the manually collapsed one.
    fireEvent.click(screen.getByTestId("bunch-weights-expand-all"));
    expect(screen.getByText("Block A")).toBeInTheDocument();
    expect(screen.getByText("Block C")).toBeInTheDocument();
  });
});

describe("Bunch Weights variety summary", () => {
  const r = (id: string, paddock: string | null, key: string, g: number): YieldBunchWeightRow => ({
    id, vineyard_id: "v1", paddock_id: paddock, variety_key: key, variety_name: key, bunch_weight_grams: g, updated_at: null,
  });
  const bl: BunchWeightBlock[] = [
    { id: "a", name: "A", plantings: [{ key: "cab", name: "Cab", percent: 100, legacyKey: false }] },
    { id: "b", name: "B", plantings: [{ key: "cab", name: "Cab", percent: 100, legacyKey: false }] },
    { id: "c", name: "C", plantings: [{ key: "chard", name: "Chard", percent: 100, legacyKey: false }] },
    { id: "d", name: "D", plantings: [{ key: "chard", name: "Chard", percent: 100, legacyKey: false }] },
    { id: "e", name: "E", plantings: [{ key: "merlot", name: "Merlot", percent: 100, legacyKey: false }] },
  ];
  const rws = [r("1", "a", "cab", 120), r("2", "c", "chard", 80), r("3", "d", "chard", 90)];
  const show = () => {
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><BunchWeightsPanel vineyardId="v1" role="viewer" blocks={bl} rows={rws} /></QueryClientProvider>);
  };
  it("all overridden: range and Configured per block", () => {
    show();
    const row = screen.getByTestId("variety-row-chard");
    expect(within(row).getByText("80–90 g")).toBeInTheDocument();
    expect(within(row).getByText("Configured per block")).toBeInTheDocument();
  });
  it("partial: used value and Partially configured count", () => {
    show();
    const row = screen.getByTestId("variety-row-cab");
    expect(within(row).getByText("120 g")).toBeInTheDocument();
    expect(within(row).getByText("Partially configured (1/2)")).toBeInTheDocument();
  });
  it("none: dash and Not configured", () => {
    show();
    const row = screen.getByTestId("variety-row-merlot");
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).getByText("Not configured")).toBeInTheDocument();
  });
});
