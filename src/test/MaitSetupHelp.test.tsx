import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MaitSetupHelp } from "@/components/mait/MaitSetupHelp";
import { MaitIrrigationPathDiagram } from "@/components/mait/MaitIrrigationPathDiagram";

afterEach(cleanup);
describe("MAIT setup instructions", () => {
  it("shows the seven-stage acceptance path, mapping methods and paused pilot branch", () => {
    render(<MaitIrrigationPathDiagram />);
    const diagram = within(screen.getByRole("region", { name: "MAIT irrigation path" }));
    const headings = diagram.getAllByRole("heading", { level: 4 }).map(heading => heading.textContent);
    expect(headings).toEqual(["Shared MAIT Weather connection", "Confirm MAIT irrigation controller module", "Output → VineTrack valve", "Share water between blocks", "Preview MAIT usage — READ-ONLY", "Confirm retrieval method", "Irrigation Records & Reports"]);
    for (const method of ["Rows", "Manual %", "Emitter count", "Vine count", "Irrigated area"]) expect(diagram.getByText(method)).toBeVisible();
    expect(diagram.getByText("Manual Confirm & Sync")).toBeVisible();
    expect(diagram.getByText("6-hour auto retrieval").parentElement).toHaveTextContent("System Admin pilot only. Scheduler installed but PAUSED");
    expect(diagram.getByText("6-hour auto retrieval").parentElement).toHaveTextContent("separate preference requiring approval");
    expect(diagram.getByText(/Compare run timestamps/)).toHaveTextContent("No irrigation records are created");
    expect(diagram.getByText(/Controller-reported water volume is recorded/)).toHaveTextContent("not live flow monitoring");
  });
  it("opens only on request, shows the customer setup steps, and closes", () => {
    render(<MaitSetupHelp />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "MAIT setup instructions" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("heading", { name: "How to configure MAIT iNTELLiWeb" })).toBeVisible();
    for (const guidance of [/user must have getdata access/, /^Network ID$/, /^Test connection$/, /^Save weather module$/, /^Inspect weather channels$/, /channel numbers are not universal/, /^Daily cumulative rainfall$/, /Only a confirmed daily-cumulative/, /^Irrigation Setup$/, /does not start, stop or program/, /password is stored securely/]) {
      expect(dialog.getByText(guidance)).toBeVisible();
    }
    expect(dialog.getByRole("heading", { name: "Map the weather channels" })).toBeVisible();
    fireEvent.click(dialog.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});