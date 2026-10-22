// Program help control: info icon beside the heading, help dialog opens on
// click and closes; content uses existing Portal labels and never writes data.
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SprayJobsPage from "@/pages/setup/SprayJobsPage";
import ProgramHelpDialog from "@/components/spray/ProgramHelpDialog";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/spray-jobs"]}>
        <Routes><Route path="/spray-jobs" element={<SprayJobsPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Program help dialog", () => {
  it("shows an info control labelled 'How the Program works' beside the heading, closed by default", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /Spray Program/i })).toBeTruthy();
    const btn = screen.getByRole("button", { name: "How the Program works" });
    expect(btn).toBeTruthy();
    // Dialog content is not rendered until opened.
    expect(screen.queryByText("How the Program Works")).toBeNull();
  });

  it("opens with all required sections and the existing Portal labels, and closes", () => {
    render(<ProgramHelpDialog />);
    fireEvent.click(screen.getByRole("button", { name: "How the Program works" }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText("How the Program Works")).toBeTruthy();
    for (const t of ["Foliar Spray", "Banded Spray", "Spreader", "Fertigation"]) {
      expect(within(dlg).getByText(t)).toBeTruthy();
    }
    // Existing Portal tab names only.
    expect(within(dlg).getAllByText("Planned Sprays").length).toBeGreaterThan(0);
    for (const s of ["Upcoming", "In Progress", "Completed", "All"]) {
      expect(within(dlg).getAllByText(s).length).toBeGreaterThan(0);
    }
    expect(within(dlg).getByText("Program = what you plan to do.")).toBeTruthy();
    expect(within(dlg).getByText(/reflected in the vineyard/i)).toBeTruthy();
    // Dialog's built-in X button also carries the name "Close"; click the footer one.
    const closeButtons = within(dlg).getAllByRole("button", { name: "Close" });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not open automatically", () => {
    renderPage();
    expect(screen.queryByText("How the Program Works")).toBeNull();
  });
});
