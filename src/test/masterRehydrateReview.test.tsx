import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import {
  masterRefreshRequestBody,
  rehydrationScopeIds,
  rehydratedQueueIds,
  runCatalogueRefresh,
  pendingIds,
} from "@/lib/masterCatalogueRefresh";

vi.mock("@/lib/masterChemicals", async (orig) => {
  const m: any = await orig();
  return { ...m, setMasterReviewStatus: vi.fn() };
});
vi.mock("@/lib/masterCuration", async (orig) => {
  const m: any = await orig();
  return { ...m, approveWithCorrections: vi.fn() };
});
import { approveWithCorrections } from "@/lib/masterCuration";
import { MasterCurationDrawer } from "@/components/chemicals/MasterCurationDrawer";

const rows = [
  { id: "a", review_status: "candidate" },
  { id: "b", review_status: "approved" },
  { id: "c", review_status: "candidate" },
  { id: "d", review_status: "retired" },
];

describe("rehydration scope + request", () => {
  it("uses ALL candidates, independent of the UI filter, and excludes approved", () => {
    expect(rehydrationScopeIds(rows)).toEqual(["a", "c"]);
  });
  it("sends apply:true and no hard-coded country", () => {
    const body = masterRefreshRequestBody("a", "cid") as any;
    expect(body).toMatchObject({ action: "master_refresh", masterChemicalId: "a", master_chemical_id: "a", apply: true });
    expect(body.country).toBeUndefined();
    expect(body.country_code).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/"AU"|approved/);
  });
  it("can stop and resume without restarting completed rows; queue holds processed ids", async () => {
    let calls: string[] = [];
    let stop = false;
    const invoke = async (id: string) => { calls.push(id); if (id === "b") stop = true; return { outcome: id === "c" ? "conflict" : "material_change", applied: true }; };
    const first = await runCatalogueRefresh({ ids: ["a", "b", "c", "d"], concurrency: 1, invoke, isCancelled: () => stop });
    expect(calls).toEqual(["a", "b"]);
    expect(pendingIds(first, ["a", "b", "c", "d"])).toEqual(["c", "d"]);
    calls = []; stop = false;
    const second = await runCatalogueRefresh({ ids: ["a", "b", "c", "d"], concurrency: 1, invoke: async (id) => { calls.push(id); return id === "d" ? Promise.reject(new Error("503")) : { outcome: "conflict" }; }, initialState: first });
    expect(calls).toEqual(["c", "d"]);
    expect(rehydratedQueueIds(second)).toEqual(["a", "b", "c"]);
  });
});

const base = {
  id: "m1",
  review_status: "candidate",
  registered_product_name: "Nufarm Weedmaster DUO Herbicide",
  registrant: "Nufarm",
  product_category: "herbicide",
  registration_country: "AU",
  registration_number: "53576",
  label_reference: "https://portal.apvma.gov.au/label/53576",
} as any;

function renderDrawer(row: any, props: any = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MasterCurationDrawer row={row} open onOpenChange={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

describe("review drawer", () => {
  it("is ~75vw on desktop", () => {
    renderDrawer(base);
    expect(screen.getByTestId("master-review-drawer").className).toMatch(/lg:w-\[75vw\].*lg:max-w-\[75vw\]/);
    expect(screen.getByTestId("master-review-drawer").className).not.toMatch(/max-w-xl|max-w-2xl/);
  });
  it("never uses the regulator label as the header label; flags it missing", () => {
    renderDrawer(base);
    expect(screen.queryByTestId("header-manufacturer-label")).toBeNull();
    expect(screen.getByTestId("manufacturer-label-missing")).toHaveTextContent("Manufacturer label missing");
    expect(screen.getByRole("button", { name: /Find Missing Data for manufacturer label/ })).toBeInTheDocument();
  });
  it("renders every section and distinct status states; generic registration wording", () => {
    renderDrawer(base);
    for (const id of ["product", "actives", "uses", "rates", "safety", "sources", "issues"]) {
      expect(screen.getByTestId(`section-${id}`)).toBeInTheDocument();
    }
    const states = new Set(Array.from(document.querySelectorAll("[data-status]")).map((e) => e.getAttribute("data-status")));
    expect(states.has("ok")).toBe(true);
    expect(states.has("missing")).toBe(true);
    expect(screen.getByText(/Reg\. 53576/)).toBeInTheDocument();
    expect(screen.queryByText(/APVMA 53576/)).toBeNull();
  });
});

describe("wording", () => {
  it("has no unconditional APVMA wording in generic Master UI", () => {
    const page = readFileSync("src/pages/admin/MasterCataloguePage.tsx", "utf8");
    const drawer = readFileSync("src/components/chemicals/MasterCurationDrawer.tsx", "utf8");
    for (const s of [page, drawer]) {
      expect(s).not.toMatch(/No APVMA number|APVMA evidence|or APVMA number|`APVMA \$\{/);
    }
  });
});
