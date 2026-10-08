import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const created = { id: "new-1", vineyard_id: "v1", name: "Smith Crew", kind: "crew", contact_name: null, phone: null, email: null, notes: null, is_active: true };
let rows: any[] = [];
vi.mock("@/lib/externalResources", async (orig) => {
  const m: any = await orig();
  return { ...m,
    listExternalResources: vi.fn(async () => rows),
    createExternalResource: vi.fn(async () => { rows = [created]; return { id: "new-1" }; }),
  };
});
import ResourcePicker from "@/components/people/ResourcePicker";
import { COMPLETED_BADGE_CLASS } from "@/lib/workTaskCompletion";

const wrap = (ui: any) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const base = { value: { kind: "none" } as const, members: [], externals: [], vineyardId: "v1", memberName: () => null };

describe("resource picker quick-add", () => {
  it("hides + for non-managers", () => {
    wrap(<ResourcePicker {...base} onChange={() => {}} quickAdd={{ canManage: false, userId: "u" }} />);
    expect(screen.queryByLabelText("Add crew / contractor")).toBeNull();
  });
  it("creates and auto-selects the new crew", async () => {
    rows = [];
    const onChange = vi.fn();
    wrap(<ResourcePicker {...base} onChange={onChange} quickAdd={{ canManage: true, userId: "u" }} />);
    fireEvent.click(screen.getByLabelText("Add crew / contractor"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Smith Crew" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: "external", id: "new-1" }, expect.objectContaining({ name: "Smith Crew" })));
  });
  it("blocks duplicate names", async () => {
    rows = [created];
    wrap(<ResourcePicker {...base} onChange={() => {}} quickAdd={{ canManage: true, userId: "u" }} />);
    fireEvent.click(screen.getByLabelText("Add crew / contractor"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "smith  crew" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
  });
  it("Completed badge uses the shared success token", () => {
    expect(COMPLETED_BADGE_CLASS).toContain("bg-success");
    expect(COMPLETED_BADGE_CLASS).toContain("text-success-foreground");
  });
});
