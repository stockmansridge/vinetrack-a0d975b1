import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DeleteUserDialog } from "@/components/admin/DeleteUserDialog";

const mocks = vi.hoisted(() => ({ remove: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/adminDeleteUser", () => ({
  previewUserDeletion: async () => ({ vineyards_to_delete: [{ id: "demo", name: "Demo" }], vineyards_to_keep: [] }),
  deleteUserPermanently: mocks.remove,
}));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));

async function confirmDeletion() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const close = vi.fn();
  render(<QueryClientProvider client={client}><DeleteUserDialog user={{ user_id: "demo-user", email: "demo@example.test", display_name: "Demo" }} onOpenChange={close} /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByPlaceholderText("demo@example.test"), { target: { value: "demo@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  return { invalidate, close };
}
describe("account deletion membership refresh", () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); });
  it("refreshes memberships and archived vineyards after deletion", async () => {
    mocks.remove.mockResolvedValue({ success: true, errors: [], deleted_vineyards: [{ id: "demo" }] });
    const { invalidate, close } = await confirmDeletion();
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["memberships"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["archived-vineyards"] });
  });
  it("keeps partial deletion visible instead of reporting complete removal", async () => {
    mocks.remove.mockResolvedValue({ success: true, errors: ["vineyards: deletion blocked"], deleted_vineyards: [{ id: "demo" }] });
    const { invalidate, close } = await confirmDeletion();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(close).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["memberships"] });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Deletion needs review" }));
    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeDisabled();
  });
  it("refreshes memberships even when the server reports failure after partial work", async () => {
    mocks.remove.mockRejectedValue(new Error("Could not remove login"));
    const { invalidate } = await confirmDeletion();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Delete failed" })));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["memberships"] });
  });
});