import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import IntegrationDocsPage from "@/pages/settings/IntegrationDocsPage";
import { POSTMAN_FILENAME } from "@/lib/developerDocs";

describe("Integration docs — Postman download action", () => {
  let clicked: HTMLAnchorElement[] = [];
  let createObjectURL: any;

  beforeEach(() => {
    clicked = [];
    createObjectURL = vi.fn(() => "blob:mock");
    (URL as any).createObjectURL = createObjectURL;
    (URL as any).revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers an enabled Postman collection download with no 'not provided' state", () => {
    render(
      <MemoryRouter>
        <IntegrationDocsPage />
      </MemoryRouter>,
    );

    const btn = screen.getByRole("button", { name: /postman collection/i });
    expect(btn).toBeEnabled();
    expect(btn.getAttribute("title") ?? "").not.toMatch(/not published|not provided|unavailable/i);

    fireEvent.click(btn);

    expect(createObjectURL).toHaveBeenCalled();
    expect(clicked.at(-1)?.download).toBe(POSTMAN_FILENAME);
  });
});
