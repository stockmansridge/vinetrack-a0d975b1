import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import PanelTabs from "@/components/paddocks/PanelTabs";

function Harness() {
  const [v, setV] = useState("a");
  return (
    <div data-testid="scroller" style={{ overflowY: "auto" }}>
      <button onClick={() => setV("c")}>go c</button>
      <PanelTabs value={v} onValueChange={setV} tabs={[
        { id: "a", label: "A", content: <input aria-label="field a" /> },
        { id: "b", label: "B", content: <p>B body</p> },
        { id: "c", label: "C", content: <p>C body</p> },
      ]} />
    </div>
  );
}

describe("PanelTabs", () => {
  it("resets only the panel scroll on click, keyboard and programmatic changes", () => {
    render(<Harness />);
    const sc = screen.getByTestId("scroller");
    sc.scrollTop = 500; fireEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(sc.scrollTop).toBe(0);
    sc.scrollTop = 300; fireEvent.click(screen.getByText("go c"));
    expect(sc.scrollTop).toBe(0);
    expect(screen.getByRole("tab", { name: "C" }).getAttribute("aria-selected")).toBe("true");
  });
  it("keeps panels mounted and supports roving arrow/Home/End keys", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("field a"), { target: { value: "typed" } });
    const a = screen.getByRole("tab", { name: "A" });
    expect(a.tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: "B" }).tabIndex).toBe(-1);
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "B" }));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("tab", { name: "C" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(screen.getByRole("tab", { name: "A" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByLabelText("field a") as HTMLInputElement).value).toBe("typed");
  });
});
