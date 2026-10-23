// Reports catalogue card headings: the Vineyard Costings card must read
// "Vineyard Costings - Reports & Exports" (view title first), while other
// cards keep the existing "{activity label} — {view title}" order.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SearchDestination } from "@/lib/navigationConfig";
import ReportsIndexPage from "@/pages/reports/ReportsIndexPage";

vi.mock("@/hooks/useNavViewer", () => ({
  useNavViewer: () => ({ isOwner: true, isManager: false, isSystemAdmin: false }),
}));

vi.mock("@/lib/navigationConfig", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/navigationConfig")>();
  return {
    ...original,
    reportDestinations: () => [
      {
        title: "Cost Reports",
        path: "/reports/costs",
        group: "Reports & Exports",
        keywords: [],
        view: { id: "reports.costs", label: "Vineyard Costings", report: true },
        activity: { id: "reports", label: "Reports & Exports", icon: () => null, views: [] },
      } as unknown as SearchDestination,
    ],
  };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/reports"]}>
      <ReportsIndexPage />
    </MemoryRouter>,
  );
}

describe("Reports catalogue card headings", () => {
  it("reads the Vineyard Costings card view-title first, activity second", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Vineyard Costings - Reports & Exports" })).toBeTruthy();
  });

  it("does not render the back-to-front 'Reports & Exports — Vineyard Costings' order", () => {
    renderPage();
    expect(screen.queryByRole("heading", { name: "Reports & Exports — Vineyard Costings" })).toBeNull();
  });
});
