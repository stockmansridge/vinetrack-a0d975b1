import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TractorReferencePhoto from "@/components/equipment/TractorReferencePhoto";

describe("tractor reference photo", () => {
  it("opens the matching reference without triggering tractor navigation", () => {
    let navigated = false;
    render(<div onClick={() => { navigated = true; }}><TractorReferencePhoto tractor={{ brand: "Fendt", model: "211 V Vario", model_year: 2016 }} /></div>);
    fireEvent.click(screen.getByRole("button", { name: "View Fendt 211 V Vario reference photo" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(navigated).toBe(false);
  });
  it("does not treat a generic 211 model as a verified vineyard variant", () => {
    render(<TractorReferencePhoto tractor={{ brand: "Fendt", model: "211", model_year: 2016 }} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("img", { name: "No verified reference photo available" })).toBeInTheDocument();
  });
  it("does not show a photo for incomplete identification", () => {
    render(<TractorReferencePhoto tractor={{ brand: "Fendt", model: "211V", model_year: null }} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("replaces a failed image with an unavailable state", () => {
    render(<TractorReferencePhoto tractor={{ brand: "Fendt", model: "211V", model_year: 2012 }} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("button")).toBeNull();
  });
});