import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const saveMock = vi.fn();
const approveMock = vi.fn();

vi.mock("@/lib/masterWorkbench", async (orig) => {
  const mod = await orig<typeof import("@/lib/masterWorkbench")>();
  return { ...mod, masterIssues: vi.fn(() => []) };
});
vi.mock("@/lib/masterCuration", async (orig) => {
  const mod = await orig<typeof import("@/lib/masterCuration")>();
  return { ...mod, saveMasterCuration: (...a: any[]) => saveMock(...a) };
});
vi.mock("@/lib/masterChemicals", async (orig) => {
  const mod = await orig<typeof import("@/lib/masterChemicals")>();
  return { ...mod, setMasterReviewStatus: (...a: any[]) => approveMock(...a) };
});

import { approveWithCorrections, CORRECTIONS_SAVE_UNCONFIRMED } from "@/lib/masterCuration";
import { MasterCurationDrawer } from "@/components/chemicals/MasterCurationDrawer";
import { resistanceGroupDisplay, toChemicalIntelligence, RESISTANCE_MANUAL_WARNING } from "@/lib/chemicalIntelligence";

const row = {
  id: "m1",
  registered_product_name: "Prod",
  registrant: "Old Co",
  product_category: "fungicide",
  form_type: "SC",
  label_reference: null,
  review_status: "candidate",
  viticulture_rates: [],
} as any;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}

function renderDrawer(props: Partial<React.ComponentProps<typeof MasterCurationDrawer>> = {}) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const onOpenChange = vi.fn();
  const onNextAttention = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <MasterCurationDrawer row={row} open onOpenChange={onOpenChange} onNextAttention={onNextAttention} {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, onOpenChange, onNextAttention, qc };
}

const editRegistrant = (v: string) =>
  fireEvent.change(screen.getByDisplayValue("Old Co"), { target: { value: v } });

beforeEach(() => {
  saveMock.mockReset();
  approveMock.mockReset();
});

describe("save confirmation before approval", () => {
  it("stops with save_unconfirmed when the refreshed row is missing", async () => {
    const approve = vi.fn();
    const res = await approveWithCorrections(
      { row, identity: { registrant: "New Co" }, reason: "" },
      { save: async () => ({ outcome: "ok", message: "", row: null, raw: null }) as any, approve },
    );
    expect(res).toEqual({ outcome: "save_unconfirmed", saved: true, message: CORRECTIONS_SAVE_UNCONFIRMED });
    expect(approve).not.toHaveBeenCalled();
  });

  it("stops when the returned row is for a different record", async () => {
    const approve = vi.fn();
    const res = await approveWithCorrections(
      { row, identity: { registrant: "New Co" }, reason: "" },
      { save: async () => ({ outcome: "ok", message: "", row: { ...row, id: "other" }, raw: null }) as any, approve },
    );
    expect(res.outcome).toBe("save_unconfirmed");
    expect(approve).not.toHaveBeenCalled();
  });
});

describe("drawer Approve & Next", () => {
  it("finishes corrections before approval and advances only after success", async () => {
    const order: string[] = [];
    const saveD = deferred<any>();
    saveMock.mockImplementation(() => (order.push("save"), saveD.promise));
    approveMock.mockImplementation(async () => void order.push("approve"));
    const { onNextAttention } = renderDrawer();
    editRegistrant("New Co");
    fireEvent.click(screen.getByRole("button", { name: /Approve & Next/ }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(approveMock).not.toHaveBeenCalled();
    expect(onNextAttention).not.toHaveBeenCalled();
    await act(async () => saveD.resolve({ outcome: "ok", message: "", row: { ...row, registrant: "New Co" }, raw: null }));
    await waitFor(() => expect(onNextAttention).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["save", "approve"]);
    expect(saveMock.mock.calls[0][0].identity.registrant).toBe("New Co");
  });

  it("keeps the draft and does not advance when the save fails", async () => {
    saveMock.mockResolvedValue({ outcome: "conflict", message: "Stale", row: null, raw: null });
    const { onNextAttention } = renderDrawer();
    editRegistrant("New Co");
    fireEvent.click(screen.getByRole("button", { name: /Approve & Next/ }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByDisplayValue("New Co")).not.toBeDisabled());
    expect(approveMock).not.toHaveBeenCalled();
    expect(onNextAttention).not.toHaveBeenCalled();
  });

  it("does not approve or advance when the save cannot be confirmed", async () => {
    saveMock.mockResolvedValue({ outcome: "ok", message: "", row: null, raw: null });
    const { onNextAttention } = renderDrawer();
    editRegistrant("New Co");
    fireEvent.click(screen.getByRole("button", { name: /Approve & Next/ }));
    await waitFor(() => expect(screen.getByDisplayValue("New Co")).not.toBeDisabled());
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(approveMock).not.toHaveBeenCalled();
    expect(onNextAttention).not.toHaveBeenCalled();
  });
});

describe("pending-operation guard", () => {
  it("blocks Escape dismissal and navigation while saving, and never advances a different record", async () => {
    const saveD = deferred<any>();
    saveMock.mockReturnValue(saveD.promise);
    approveMock.mockResolvedValue(undefined);
    const onNext = vi.fn();
    const { onOpenChange, onNextAttention, rerender, qc } = renderDrawer({ hasNext: true, onNext });
    editRegistrant("New Co");
    fireEvent.click(screen.getByRole("button", { name: /Approve & Next/ }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    const next = screen.getByRole("button", { name: /^Next$/ });
    expect(next).toBeDisabled();
    expect(screen.getByRole("button", { name: /Next needing attention/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Find missing data$/i })).toBeDisabled();

    // Selection changes underneath (e.g. external list navigation) before completion.
    rerender(
      <QueryClientProvider client={qc}>
        <MasterCurationDrawer row={{ ...row, id: "m2" }} open onOpenChange={onOpenChange} onNextAttention={onNextAttention} />
      </QueryClientProvider>,
    );
    await act(async () => saveD.resolve({ outcome: "ok", message: "", row: { ...row, registrant: "New Co" }, raw: null }));
    await waitFor(() => expect(approveMock).toHaveBeenCalled());
    expect(onNextAttention).not.toHaveBeenCalled();
  });
});

describe("unknown-origin group wording", () => {
  it("shows retained text as unverified without changing classification", () => {
    const d = resistanceGroupDisplay(
      toChemicalIntelligence({
        id: "c1", name: "X", chemical_group: "Group 3", verification_status: "unverified",
        resistance_classification_state: "unresolved",
      } as any),
    );
    expect(d.text).toBe("Group 3 (unverified)");
    expect(d.text).not.toContain("manual");
    expect(d.warning).toBe(RESISTANCE_MANUAL_WARNING);
  });
});
