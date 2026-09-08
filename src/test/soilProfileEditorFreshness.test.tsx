import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { rpc: (...a: any[]) => rpc(...a) },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import SoilProfileEditDialog from "@/components/soil/SoilProfileEditDialog";
import SoilProfileStatus from "@/components/soil/SoilProfileStatus";

const PADDOCK = "11111111-1111-1111-1111-111111111111";

const row = (awc: number) => ({
  paddock_id: PADDOCK,
  irrigation_soil_class: "loam",
  available_water_capacity_mm_per_m: awc,
  effective_root_depth_m: 0.8,
  management_allowed_depletion_percent: 35,
});

function readsFor(name: string) {
  return rpc.mock.calls.filter((c) => c[0] === name).length;
}

function mockProfile(awc: number) {
  rpc.mockImplementation((name: string) => {
    if (name === "get_soil_class_defaults") return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: [row(awc)], error: null });
  });
}

function dialog() {
  return (
    <SoilProfileEditDialog
      paddockId={PADDOCK}
      paddockName="Blok 1"
      vineyardId={null}
      trigger={<button>Edit soil</button>}
    />
  );
}

function numberInputs() {
  return screen.getAllByRole("spinbutton") as HTMLInputElement[];
}

function saveButton() {
  return screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => rpc.mockReset());

describe("soil editor freshness", () => {
  it("re-reads the profile each time it opens, inside the cache window", async () => {
    mockProfile(140);
    render(<QueryClientProvider client={newClient()}>{dialog()}</QueryClientProvider>);

    fireEvent.click(screen.getByText("Edit soil"));
    await waitFor(() => expect(numberInputs()[0].value).toBe("140"));
    const firstReads = readsFor("get_paddock_soil_profile");
    expect(firstReads).toBe(1);

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryAllByRole("spinbutton").length).toBe(0));

    // Stored value changed on mobile while the dialog was closed.
    mockProfile(99);
    fireEvent.click(screen.getByText("Edit soil"));
    await waitFor(() => expect(numberInputs()[0].value).toBe("99"));
    expect(readsFor("get_paddock_soil_profile")).toBeGreaterThan(firstReads);
  });

  it("blocks saving until the opening read resolves", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "get_soil_class_defaults") return Promise.resolve({ data: [], error: null });
      return new Promise((res) =>
        setTimeout(() => res({ data: [row(140)], error: null }), 150),
      );
    });
    render(<QueryClientProvider client={newClient()}>{dialog()}</QueryClientProvider>);
    fireEvent.click(screen.getByText("Edit soil"));

    expect(await screen.findByText(/Loading saved soil profile/i)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);

    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(numberInputs()[0].value).toBe("140");
  });


  it("shows a retry action and keeps saving disabled after a failed read", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "get_soil_class_defaults") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: { message: "not_authorized" } });
    });
    render(<QueryClientProvider client={newClient()}>{dialog()}</QueryClientProvider>);
    fireEvent.click(screen.getByText("Edit soil"));

    expect(await screen.findByText(/not_authorized/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it("does not overwrite unsaved typing on a background refetch", async () => {
    mockProfile(140);
    const qc = newClient();
    render(<QueryClientProvider client={qc}>{dialog()}</QueryClientProvider>);

    fireEvent.click(screen.getByText("Edit soil"));
    await waitFor(() => expect(numberInputs()[0].value).toBe("140"));

    fireEvent.change(numberInputs()[0], { target: { value: "222" } });
    await act(async () => {
      await qc.refetchQueries({ queryKey: ["soil", "paddock", PADDOCK] });
    });
    expect(numberInputs()[0].value).toBe("222");
  });
});

describe("advisor soil status", () => {
  it("shows loading, then a visible error with retry", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<SoilProfileStatus loading error={null} onRetry={onRetry} />);
    expect(screen.getByText(/Loading soil profiles/i)).toBeTruthy();

    rerender(
      <SoilProfileStatus loading={false} error={{ message: "not_authorized" }} onRetry={onRetry} />,
    );
    expect(screen.getByText(/Could not load soil profiles: not_authorized/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });
});
