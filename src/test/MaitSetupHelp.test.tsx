import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MaitSetupHelp } from "@/components/mait/MaitSetupHelp";

afterEach(cleanup);
describe("MAIT setup instructions", () => {
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