import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ResourcePicker from "@/components/people/ResourcePicker";
import {
  buildResourceGroups, findDuplicateName, persistPruningResourceAfterSave, pruningResourceValue,
  pruningWorkerSnapshot, workTaskAssignmentFields, workTaskAssignmentValue, canManageExternalResources,
  type ExternalResource,
} from "@/lib/externalResources";
import { assignmentCellLabel } from "@/lib/workTaskCompletion";

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
    expect(screen.getByText("Unassigned")).toBeTruthy();
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

describe("pruning resource persistence", () => {
  it("skips the RPC when the resource was not changed (keeps older association)", async () => {
    const call = vi.fn();
    expect(await persistPruningResourceAfterSave("a1", { kind: "none" }, false, call)).toEqual({ status: "skipped" });
    expect(call).not.toHaveBeenCalled();
  });
  it("calls RPC once on explicit change; reports failure for retry", async () => {
    const ok = vi.fn().mockResolvedValue(undefined);
    expect((await persistPruningResourceAfterSave("a1", { kind: "external", id: "e1" }, true, ok)).status).toBe("ok");
    expect(ok).toHaveBeenCalledWith("a1", { kind: "external", id: "e1" });
    const bad = vi.fn().mockRejectedValue(new Error("cross-vineyard"));
    expect(await persistPruningResourceAfterSave("a1", { kind: "member", userId: "u1" }, true, bad)).toEqual({ status: "failed", error: "cross-vineyard" });
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
