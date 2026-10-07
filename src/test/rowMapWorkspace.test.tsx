import { useEffect, useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RowMapWorkspace from "@/components/paddocks/RowMapWorkspace";

describe("row map workspace", () => {
  it("keeps the map, partial input and settings state through hide/full-screen/fit", () => {
    const mount = vi.fn(), destroy = vi.fn(), fit = vi.fn();
    function Map() {
      const [zoom, setZoom] = useState(4);
      useEffect(() => { mount(); return destroy; }, []);
      return <button onClick={() => setZoom(zoom + 1)}>Map zoom {zoom}</button>;
    }
    const view = render(<RowMapWorkspace onFit={fit} settings={<input aria-label="Spacing" defaultValue="2.5" />}><Map /></RowMapWorkspace>);
    const input = screen.getByLabelText("Spacing") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3." } });
    fireEvent.click(screen.getByRole("button", { name: "Map zoom 4" }));
    const map = screen.getByRole("button", { name: "Map zoom 5" });
    fireEvent.click(screen.getByRole("button", { name: "Hide settings" }));
    expect(input).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    const workspace = screen.getByRole("region", { name: "Row setup map workspace" });
    expect(workspace.parentElement?.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Show settings" }));
    expect(screen.getByLabelText("Spacing")).toBe(input);
    expect(input.value).toBe("3.");
    fireEvent.click(screen.getByRole("button", { name: "Fit to block" }));
    expect(fit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(workspace).toHaveAttribute("data-full-screen", "false");
    expect(workspace.parentElement?.parentElement).toHaveAttribute("data-row-map-anchor");
    expect(screen.getByRole("button", { name: "Map zoom 5" })).toBe(map);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
    view.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape to open dialogs and removes the full-screen host on navigation", () => {
    document.body.style.overflow = "auto";
    const { unmount } = render(<RowMapWorkspace onFit={() => {}} settings={<div>Settings</div>}><div>Map</div></RowMapWorkspace>);
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    const workspace = screen.getByRole("region");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog"); dialog.dataset.state = "open";
    document.body.append(dialog);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(workspace).toHaveAttribute("data-full-screen", "true");
    dialog.remove();
    unmount();
    expect(workspace).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });
});
