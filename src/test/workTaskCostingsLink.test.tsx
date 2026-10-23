// Work Tasks sub menu: owners and managers get a "Vineyard Costings" link that
// sits to the right of the existing "Reports" pill; other roles never see it
// (the /reports/costs route allow-list is owner/manager only).
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { NavViewer } from "@/lib/navigationConfig";

let viewer: NavViewer;

vi.mock("@/hooks/useNavViewer", () => ({
  useNavViewer: () => viewer,
}));

const { ActivityNavigation } = await import("@/components/navigation/ActivityNavigation");

function renderWorkTasksNav(role: string | null) {
  viewer = {
    role,
    isSystemAdmin: false,
    irrigation: { records: false, reports: false, setup: false },
    hasAccountBilling: false,
    vineyardCountry: "Australia",
    loading: false,
  };
  return render(
    <MemoryRouter initialEntries={["/work-tasks"]}>
      <ActivityNavigation />
    </MemoryRouter>,
  );
}

function hrefs() {
  return screen.getAllByRole("link").map((l) => l.getAttribute("href"));
}

describe("Work Tasks sub menu", () => {
  it("shows Vineyard Costings to the right of Reports for owners", () => {
    renderWorkTasksNav("owner");
    const links = hrefs();
    expect(links).toContain("/reports/costs");
    expect(links.indexOf("/reports/work-tasks")).toBeLessThan(links.indexOf("/reports/costs"));
    expect(screen.getByRole("link", { name: "Vineyard Costings" })).toBeTruthy();
  });

  it("shows Vineyard Costings to managers too", () => {
    renderWorkTasksNav("manager");
    expect(screen.getByRole("link", { name: "Vineyard Costings" })).toBeTruthy();
  });

  it("hides Vineyard Costings from supervisors and operators", () => {
    renderWorkTasksNav("supervisor");
    expect(screen.queryByRole("link", { name: "Vineyard Costings" })).toBeNull();
    expect(hrefs()).not.toContain("/reports/costs");
    renderWorkTasksNav("operator");
    expect(screen.queryByRole("link", { name: "Vineyard Costings" })).toBeNull();
    expect(hrefs()).not.toContain("/reports/costs");
  });
});
