// Soil Analysis help control: info control beside the Soil Analysis heading,
// dialog opens on click and closes; help copy only, never writes data and
// never presents the feature as Preview/Beta/System Admin-only.
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import SoilAnalysisHelpDialog from "@/components/soil-analysis/SoilAnalysisHelpDialog";
import SoilAnalysisPage from "@/pages/admin/SoilAnalysisPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/soil-analysis"]}>
        <SoilAnalysisPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Soil Analysis help dialog", () => {
  it("shows an info control labelled 'How Soil Analysis works' beside the heading, closed by default", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Soil Analysis" })).toBeTruthy();
    // The info control is rendered within the same header row as the heading.
    const headerRow = screen.getByRole("heading", { name: "Soil Analysis" }).parentElement!;
    expect(within(headerRow).getByRole("button", { name: "How Soil Analysis works" })).toBeTruthy();
    // Dialog content is not rendered until opened.
    expect(screen.queryByText("How Soil Analysis Works")).toBeNull();
  });

  it("opens with all seven workflow topics and the closing note, and closes", () => {
    render(<SoilAnalysisHelpDialog />);
    fireEvent.click(screen.getByRole("button", { name: "How Soil Analysis works" }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText("How Soil Analysis Works")).toBeTruthy();
    for (const t of [
      "Upload laboratory reports",
      "Review the extracted results",
      "Map the sample to your vineyard",
      "Confirm the sample",
      "Trends",
      "Compare",
      "Reports",
    ]) {
      expect(within(dlg).getByText(t)).toBeTruthy();
    }
    expect(
      within(dlg).getByText(/does not replace agronomic advice/i),
    ).toBeTruthy();
    expect(within(dlg).getByText("Choose one or more blocks and an analyte to follow measured values through time. Each block keeps its own trend line; where several samples for the same block share a date, VineTrack keeps the individual results visible and may show a clearly labelled date average.")).toBeTruthy();
    const closeButtons = within(dlg).getAllByRole("button", { name: "Close" });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never presents Soil Analysis as Preview, Beta or System Admin-only", () => {
    render(<SoilAnalysisHelpDialog />);
    fireEvent.click(screen.getByRole("button", { name: "How Soil Analysis works" }));
    const dlg = screen.getByRole("dialog");
    const text = dlg.textContent ?? "";
    expect(/preview/i.test(text)).toBe(false);
    expect(/beta/i.test(text)).toBe(false);
    expect(/system admin/i.test(text)).toBe(false);
  });

  it("does not open automatically", () => {
    renderPage();
    expect(screen.queryByText("How Soil Analysis Works")).toBeNull();
  });
});
