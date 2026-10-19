import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ValveImportDialog from "./ValveImportDialog";
const api = vi.hoisted(() => ({ save: vi.fn(), vineyard: vi.fn() }));
vi.mock("@/lib/irrigationQuery", () => ({ useCreateValve: (id: string) => { api.vineyard(id); return { mutateAsync: api.save }; } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
async function upload(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Import valves" }));
  const file = new File([text], "valves.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => text });
  fireEvent.change(screen.getByLabelText("Valve CSV file"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Import 2 valves" })).toBeEnabled());
}
function setup() {
  render(<ValveImportDialog vineyardId="selected-vineyard" systems={[{ id: "system", vineyard_id: "selected-vineyard", name: "Pump", is_active: true, water_source: null, controller_provider: null, controller_name: null, external_controller_id: null, notes: null }]} valves={[]} />);
}
it("previews without saving, then creates only selected valves in the chosen vineyard/system", async () => {
  api.save.mockResolvedValue({ id: "new" }); setup();
  await upload("name,valve_number\nNorth,001\nSouth,002");
  expect(api.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Import South" }));
  fireEvent.click(screen.getByRole("button", { name: "Import 1 valve" }));
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  expect(api.vineyard).toHaveBeenCalledWith("selected-vineyard");
  expect(api.save).toHaveBeenCalledWith({ irrigation_system_id: "system", name: "North", valve_number: "001", configured_flow_litres_per_hour: null, measured_flow_litres_per_hour: null, notes: null });
});
it("stops after an unconfirmed save, never automatically retries or imports later rows", async () => {
  api.save.mockRejectedValue(new Error("Connection lost")); setup();
  await upload("name\nNorth\nSouth");
  fireEvent.click(screen.getByRole("button", { name: "Import 2 valves" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Import stopped"));
  expect(api.save).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Import 2 valves" }));
  expect(api.save).toHaveBeenCalledTimes(1);
});