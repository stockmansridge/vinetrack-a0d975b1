// Unified Add Pin / Action composer — Growth Stage picker, left/right
// deduplication and Custom catalogue routing (SQL 170).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UnifiedPinDialog from "@/components/pins/UnifiedPinDialog";
import { parseButtonCatalogue } from "@/lib/unifiedPin";

const createPin = vi.fn(async (_input: any) => "pin-1");
const createType = vi.fn(async (_input: any) => "custom-1");
const listTypes = vi.fn();

const catalogue = parseButtonCatalogue([
  {
    config_type: "repair_buttons",
    config_data: [
      { id: "broken_post_left", name: "Broken Post Left", color: "#A2845E" },
      { id: "broken_post_right", name: "Broken Post Right", color: "#A2845E" },
    ],
  },
  {
    config_type: "growth_buttons",
    config_data: [
      { id: "growth_stage_left", name: "Growth Stage Left" },
      { id: "growth_stage_right", name: "Growth Stage Right" },
      { id: "powdery_left", name: "Powdery Left", color: "#FF9500" },
      { id: "powdery_right", name: "Powdery Right", color: "#FF9500" },
      { id: "downy_left", name: "Downy Left" },
      { id: "downy_right", name: "Downy Right" },
      { id: "blackberries_left", name: "Blackberries Left" },
      { id: "blackberries_right", name: "Blackberries Right" },
    ],
  },
]);

vi.mock("@/lib/unifiedPinQuery", () => ({
  usePinButtonCatalogue: () => ({ data: catalogue, isLoading: false }),
  useCustomPinTypes: () => ({ data: listTypes(), isLoading: false }),
  useCreateCustomPinType: () => ({ mutateAsync: createType, isPending: false }),
  useCreateUnifiedPin: () => ({ mutateAsync: createPin, isPending: false }),
}));
vi.mock("@/components/manual-issues/ManualIssuesAppleMap", () => ({
  default: ({ onPick }: any) => (
    <button onClick={() => onPick(-33.1, 149.2)}>Drop map pin</button>
  ),
}));

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UnifiedPinDialog open onOpenChange={() => {}} vineyardId="v1" paddocks={[]} />
    </QueryClientProvider>,
  );
}

const placePin = () => fireEvent.click(screen.getByText("Drop map pin"));
const openGrowth = () => fireEvent.click(screen.getByRole("button", { name: "Growth" }));

describe("Add Pin / Action composer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTypes.mockReturnValue([{ id: "ct-1", name: "Large Divot", colour: null, icon: null, isActive: true }]);
  });

  it("shows one button per logical Growth type (no left/right duplicates)", () => {
    renderDialog();
    openGrowth();
    for (const name of ["Growth Stage", "Powdery", "Downy", "Blackberries"]) {
      expect(screen.getAllByRole("button", { name })).toHaveLength(1);
    }
  });

  it("shows one button per logical Repair type", () => {
    renderDialog();
    expect(screen.getAllByRole("button", { name: "Broken Post" })).toHaveLength(1);
  });

  it("opens the existing growth stage picker when Growth Stage is chosen", () => {
    renderDialog();
    openGrowth();
    fireEvent.click(screen.getByRole("button", { name: "Growth Stage" }));
    expect(screen.getByText("Select growth stage")).toBeTruthy();
    // Reuses the shared E-L catalogue, not a new list.
    expect(screen.getByLabelText("Growth stage EL23")).toBeTruthy();
  });

  it("saves the exact existing growth stage identifier with no side", async () => {
    renderDialog();
    placePin();
    openGrowth();
    fireEvent.click(screen.getByRole("button", { name: "Growth Stage" }));
    fireEvent.click(screen.getByLabelText("Growth stage EL23"));
    fireEvent.click(screen.getByText("Use stage"));
    fireEvent.click(screen.getByText("Save pin"));

    await waitFor(() => expect(createPin).toHaveBeenCalledTimes(1));
    const arg = createPin.mock.calls[0][0] as any;
    expect(arg.growthStageCode).toBe("EL23");
    expect(arg.button.id).toBe("growth_stage");
    expect(arg.form.pinType).toBe("growth");
    expect(arg).not.toHaveProperty("side");
  });

  it("cancelling the stage picker does not create a pin", async () => {
    renderDialog();
    placePin();
    openGrowth();
    fireEvent.click(screen.getByRole("button", { name: "Growth Stage" }));
    fireEvent.click(screen.getAllByText("Cancel")[0]);
    expect(createPin).not.toHaveBeenCalled();
    // Saving without a stage re-opens the picker instead of writing a pin.
    fireEvent.click(screen.getByText("Save pin"));
    await waitFor(() => expect(screen.getByText("Select growth stage")).toBeTruthy());
    expect(createPin).not.toHaveBeenCalled();
  });

  it("other growth buttons save directly", async () => {
    renderDialog();
    placePin();
    openGrowth();
    fireEvent.click(screen.getByRole("button", { name: "Powdery" }));
    fireEvent.click(screen.getByText("Save pin"));
    await waitFor(() => expect(createPin).toHaveBeenCalledTimes(1));
    const arg = createPin.mock.calls[0][0] as any;
    expect(arg.button.name).toBe("Powdery");
    expect(arg.growthStageCode).toBeNull();
  });

  it("repair save uses the deduplicated canonical button and no side", async () => {
    renderDialog();
    placePin();
    fireEvent.click(screen.getByRole("button", { name: "Broken Post" }));
    fireEvent.click(screen.getByText("Save pin"));
    await waitFor(() => expect(createPin).toHaveBeenCalledTimes(1));
    const arg = createPin.mock.calls[0][0] as any;
    expect(arg.form.pinType).toBe("repair");
    expect(arg.button.id).toBe("broken_post");
    expect(JSON.stringify(arg.button)).not.toMatch(/left|right/i);
  });

  it("lists shared custom items and saves the selected custom_type_id", async () => {
    renderDialog();
    placePin();
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    // Loaded through list_vineyard_custom_pin_types (vineyard-shared catalogue).
    fireEvent.click(screen.getByRole("button", { name: "Large Divot" }));
    fireEvent.click(screen.getByText("Save pin"));
    await waitFor(() => expect(createPin).toHaveBeenCalledTimes(1));
    const arg = createPin.mock.calls[0][0] as any;
    expect(arg.form.customTypeId).toBe("ct-1");
    expect(arg.customTypeName).toBe("Large Divot");
  });

  it("creating a custom item writes through the shared catalogue mutation", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.click(screen.getByText("Add custom item"));
    fireEvent.change(screen.getByLabelText("New custom item"), { target: { value: "Large Divot" } });
    fireEvent.click(screen.getByText("Add"));
    await waitFor(() => expect(createType).toHaveBeenCalledWith({ name: "Large Divot" }));
  });

  it("duplicate custom names converge on the existing catalogue entry", async () => {
    createType.mockResolvedValueOnce("ct-1");
    renderDialog();
    placePin();
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.click(screen.getByText("Add custom item"));
    fireEvent.change(screen.getByLabelText("New custom item"), { target: { value: "Large Divot" } });
    fireEvent.click(screen.getByText("Add"));
    await waitFor(() => expect(createType).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Save pin"));
    await waitFor(() => expect(createPin).toHaveBeenCalledTimes(1));
    expect((createPin.mock.calls[0][0] as any).form.customTypeId).toBe("ct-1");
    // Still one visible entry for that name.
    expect(screen.getAllByRole("button", { name: "Large Divot" })).toHaveLength(1);
  });
});
