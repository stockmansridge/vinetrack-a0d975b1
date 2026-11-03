// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WorkflowDiagramDialog from "@/components/help/WorkflowDiagramDialog";

const PROPS = {
  triggerLabel: "Workflow diagram",
  ariaLabel: "How the spray program workflow fits together",
  title: "Spray program workflow",
  description: "How reusable Program Steps guide planned sprays.",
  imageUrl: "/__l5e/assets-v1/test/spray-program-workflow-guide.png",
  imageAlt: "Diagram: program steps to planned sprays to records.",
  footnote: "Program = what you plan to do.",
};

describe("WorkflowDiagramDialog", () => {
  it("renders an accessible trigger with the given label", () => {
    render(<WorkflowDiagramDialog {...PROPS} />);
    const trigger = screen.getByRole("button", { name: PROPS.ariaLabel });
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain("Workflow diagram");
  });

  it("opens the dialog with title, description, diagram and full-size link", () => {
    render(<WorkflowDiagramDialog {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: PROPS.ariaLabel }));
    expect(screen.getByText("Spray program workflow")).toBeTruthy();
    expect(screen.getByText(PROPS.description)).toBeTruthy();
    const img = screen.getByAltText(PROPS.imageAlt) as HTMLImageElement;
    expect(img.src).toContain("spray-program-workflow-guide.png");
    const link = screen.getByRole("link", { name: /open full size in new tab/i }) as HTMLAnchorElement;
    expect(link.href).toContain("spray-program-workflow-guide.png");
    expect(link.target).toBe("_blank");
    expect(screen.getByText(PROPS.footnote)).toBeTruthy();
  });
});
