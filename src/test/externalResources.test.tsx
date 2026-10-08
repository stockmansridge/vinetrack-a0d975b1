import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ResourcePicker from "@/components/people/ResourcePicker";
import {
  buildResourceGroups, findDuplicateName, persistPruningResourceAfterSave, pruningResourceValue,
  pruningWorkerSnapshot, workTaskAssignmentFields, workTaskAssignmentValue, canManageExternalResources,
  type ExternalResource,
} from "@/lib/externalResources";
import { assignmentCellLabel } from "@/lib/workTaskCompletion";

(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
(Element.prototype as any).scrollIntoView ??= () => {};
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: {} }));

const V = "v1";
const ext = (id: string, name: string, extra: Partial<ExternalResource> = {}): ExternalResource => ({
  id, vineyard_id: V, name, kind: "crew", contact_name: null, phone: null, email: null, notes: null, is_active: true, ...extra,
});
const externals = [ext("e1", "Zeta Crew"), ext("e2", "Alpha Contractors", { kind: "contractor" }),
  ext("e3", "Retired Crew", { is_active: false }), ext("e4", "Other Vineyard Crew", { vineyard_id: "v2" })];
const members = [{ userId: "u2", name: "Bob" }, { userId: "u1", name: "Amy" }];
const memberName = (id: string) => members.find((m) => m.userId === id)?.name ?? null;

describe("grouped resource picker", () => {
  it("lists internal first, then only active same-vineyard externals", () => {
    const g = buildResourceGroups(members, externals, V);
    expect(g.internal.map((m) => m.name)).toEqual(["Amy", "Bob"]);
    expect(g.external.map((r) => r.name)).toEqual(["Alpha Contractors", "Zeta Crew"]);
  });

  it("renders groups in order with Unassigned and selects an external", () => {
    const onChange = vi.fn();
    render(<ResourcePicker value={{ kind: "none" }} onChange={onChange} members={members} externals={externals}
      vineyardId={V} memberName={memberName} allowUnassigned />);
    fireEvent.click(screen.getByRole("combobox", { name: "Assigned to" }));
    const headings = screen.getAllByText(/Internal resources|Crew \/ External contractors/).map((n) => n.textContent);
    expect(headings).toEqual(["Internal resources", "Crew / External contractors"]);
    expect(screen.queryByText("Retired Crew")).toBeNull();
    expect(screen.queryByText("Other Vineyard Crew")).toBeNull();
    expect(screen.getByRole("option", { name: "Unassigned" })).toBeTruthy();
    fireEvent.click(screen.getByText("Zeta Crew"));
    expect(onChange).toHaveBeenCalledWith({ kind: "external", id: "e1" });
  });
});

describe("work task one-of-two assignment", () => {
  it("writes exactly one id and clears the other", () => {
    expect(workTaskAssignmentFields({ kind: "member", userId: "u1" })).toEqual({ assigned_to: "u1", assigned_external_resource_id: null });
    expect(workTaskAssignmentFields({ kind: "external", id: "e1" })).toEqual({ assigned_to: null, assigned_external_resource_id: "e1" });
    expect(workTaskAssignmentFields({ kind: "none" })).toEqual({ assigned_to: null, assigned_external_resource_id: null });
  });
  it("reads back and labels; completed shows actual completer, not contractor", () => {
    expect(workTaskAssignmentValue({ assigned_external_resource_id: "e1" })).toEqual({ kind: "external", id: "e1" });
    const t: any = { is_finalized: false, assigned_external_resource_id: "e1", vineyard_id: V };
    expect(assignmentCellLabel(t, [], memberName, (id) => (id === "e1" ? "Zeta Crew" : null))).toBe("Zeta Crew");
    const done: any = { ...t, is_finalized: true, completed_by: "u1" };
    expect(assignmentCellLabel(done, [], memberName, () => "Zeta Crew")).toBe("Completed by Amy");
  });
});

describe("pruning resource persistence (CAS)", () => {
  const NONE = { externalResourceId: null, workerUserId: null };
  const canon = (ext: string | null, wu: string | null, ts = "2026-10-08T01:00:00Z") =>
    ({ activity: { id: "a1", client_updated_at: ts, external_resource_id: ext, worker_user_id: wu } });
  it("skips everything when the resource was not changed", async () => {
    const readCanonical = vi.fn(); const cas = vi.fn();
    expect(await persistPruningResourceAfterSave("a1", { kind: "none" }, false, NONE, { readCanonical, cas })).toEqual({ status: "skipped" });
    expect(readCanonical).not.toHaveBeenCalled(); expect(cas).not.toHaveBeenCalled();
  });
  it("uses the post-save timestamp and current ids as CAS preconditions", async () => {
    const cas = vi.fn().mockResolvedValue({ applied: true, conflict: false, current: null });
    const r = await persistPruningResourceAfterSave("a1", { kind: "external", id: "e1" }, true, NONE,
      { readCanonical: async () => canon(null, null, "2026-10-08T09:09:09Z"), cas });
    expect(r.status).toBe("ok");
    expect(cas).toHaveBeenCalledWith("a1", { kind: "external", id: "e1" },
      { clientUpdatedAt: "2026-10-08T09:09:09Z", externalResourceId: null, workerUserId: null });
  });
  it("reports a conflict and never writes when someone else changed the selection", async () => {
    const cas = vi.fn();
    const r = await persistPruningResourceAfterSave("a1", { kind: "member", userId: "u1" }, true, NONE,
      { readCanonical: async () => canon("e2", null), cas });
    expect(r).toEqual({ status: "conflict", current: { externalResourceId: "e2", workerUserId: null } });
    expect(cas).not.toHaveBeenCalled();
  });
  it("surfaces a server CAS conflict instead of claiming success", async () => {
    const cas = vi.fn().mockResolvedValue({ applied: false, conflict: true, current: { externalResourceId: null, workerUserId: "u2" } });
    const r = await persistPruningResourceAfterSave("a1", { kind: "member", userId: "u1" }, true, NONE, { readCanonical: async () => canon(null, null), cas });
    expect(r).toEqual({ status: "conflict", current: { externalResourceId: null, workerUserId: "u2" } });
  });
  it("refuses to write when the canonical row lacks the precondition fields", async () => {
    const cas = vi.fn();
    const r = await persistPruningResourceAfterSave("a1", { kind: "external", id: "e1" }, true, NONE,
      { readCanonical: async () => ({ activity: { id: "a1", client_updated_at: "x" } }), cas });
    expect(r.status).toBe("failed"); expect(cas).not.toHaveBeenCalled();
  });
  it("reports read or RPC failures for retry", async () => {
    const r = await persistPruningResourceAfterSave("a1", { kind: "external", id: "e1" }, true, NONE,
      { readCanonical: async () => canon(null, null), cas: vi.fn().mockRejectedValue(new Error("boom")) });
    expect(r).toEqual({ status: "failed", error: "boom" });
  });
  it("preserves historical free text and stale ids; snapshot uses display name", () => {
    expect(pruningResourceValue({ worker: "Old Gang" })).toEqual({ kind: "other", text: "Old Gang" });
    expect(pruningResourceValue({ worker: "—" })).toEqual({ kind: "none" });
    expect(pruningResourceValue({ worker: "Old", externalResourceId: "e3" })).toEqual({ kind: "external", id: "e3" });
    expect(pruningWorkerSnapshot({ kind: "external", id: "e3" }, memberName, externals)).toBe("Retired Crew");
    expect(pruningWorkerSnapshot({ kind: "member", userId: "u2" }, memberName, externals)).toBe("Bob");
  });
});

describe("directory rules", () => {
  it("duplicate names are case/space-insensitive; only owner/manager manage", () => {
    expect(findDuplicateName(externals, "  zeta   crew ")?.id).toBe("e1");
    expect(findDuplicateName(externals, "Zeta Crew", "e1")).toBeNull();
    expect(canManageExternalResources("manager")).toBe(true);
    expect(canManageExternalResources("operator")).toBe(false);
  });
});
