import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TractorReferencePhoto from "@/components/equipment/TractorReferencePhoto";

const catalogue = [{ brands: ["Fendt"], models: ["211V", "211 V Vario"], firstYear: 2010, lastYear: 2016, url: "/fixture.png", sourceUrl: "https://example.test/photo", attribution: "Test fixture", label: "Fendt 211 V Vario", attachmentFree: true }];

describe("tractor reference photo", () => {
  it("opens the matching reference without triggering tractor navigation", () => {
    let navigated = false;
    render(<div onClick={() => { navigated = true; }}><TractorReferencePhoto catalogue={catalogue} tractor={{ brand: "Fendt", model: "211 V Vario", model_year: 2016 }} /></div>);
    fireEvent.click(screen.getByRole("button", { name: "View Fendt 211 V Vario reference photo" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(navigated).toBe(false);
  });
  it("does not treat a generic 211 model as a verified vineyard variant", () => {
    render(<TractorReferencePhoto tractor={{ brand: "Fendt", model: "211", model_year: 2016 }} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("does not show a photo for incomplete identification", () => {
    render(<TractorReferencePhoto tractor={{ brand: "Fendt", model: "211V", model_year: null }} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("replaces a failed image with an unavailable state", () => {
    render(<TractorReferencePhoto catalogue={catalogue} tractor={{ brand: "Fendt", model: "211V", model_year: 2012 }} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("never serves a synthetic test fixture through the live catalogue", () => {
    render(<TractorReferencePhoto tractor={{ brand: "Fendt", model: "211V", model_year: 2012 }} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});