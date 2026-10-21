import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TractorPhotoPicker from "@/components/equipment/TractorPhotoPicker";

const tractor = { brand: "New Holland", model: "T4.N", model_year: 2021 };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("tractor photo picker safety", () => {
  it("searches externally without paid requests or fabricated results", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<TractorPhotoPicker tractor={tractor} />);
    fireEvent.click(screen.getByRole("button", { name: "Search tractor images" }));
    expect(screen.getByRole("link", { name: "Search Google Images" }).getAttribute("href")).toContain(encodeURIComponent("New Holland T4.N 2021"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires all three identification fields before search", () => {
    render(<TractorPhotoPicker tractor={{ ...tractor, model_year: null }} />);
    expect(screen.getByRole("button", { name: "Search tractor images" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload image" })).toBeEnabled();
  });
  it("rejects attachments and wrong model years from the result choices", () => {
    const photo = { brands: ["New Holland"], models: ["T4.N"], firstYear: 2021, lastYear: 2021, url: "/fixture.png", sourceUrl: "https://example.test", attribution: "Fixture", label: "New Holland T4.N", attachmentFree: true };
    render(<TractorPhotoPicker tractor={tractor} catalogue={[{ ...photo, attachmentFree: false }, { ...photo, firstYear: 2022, lastYear: 2022 }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Search tractor images" }));
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("previews a verified choice and clears it when identity changes", () => {
    const photo = { brands: ["New Holland"], models: ["T4.N"], firstYear: 2021, lastYear: 2021, url: "/fixture.png", sourceUrl: "https://example.test", attribution: "Fixture", label: "New Holland T4.N", attachmentFree: true };
    const { rerender } = render(<TractorPhotoPicker tractor={tractor} catalogue={[photo]} />);
    fireEvent.click(screen.getByRole("button", { name: "Search tractor images" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview New Holland T4.N" }));
    expect(screen.getByAltText("Tractor photo preview")).toBeInTheDocument();
    rerender(<TractorPhotoPicker tractor={{ ...tractor, model_year: 2022 }} catalogue={[photo]} />);
    expect(screen.queryByAltText("Tractor photo preview")).toBeNull();
  });
  it("allows an uploaded photo preview without any network or equipment writes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:preview", revokeObjectURL: revoke });
    vi.stubGlobal("Image", class { onload?: () => void; set src(_value: string) { this.onload?.(); } });
    render(<TractorPhotoPicker tractor={tractor} />);
    fireEvent.change(screen.getByLabelText("Upload tractor image"), { target: { files: [new File(["photo"], "tractor.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByAltText("Tractor photo preview")).toHaveAttribute("src", "blob:preview"));
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove photo preview" }));
    expect(revoke).toHaveBeenCalledWith("blob:preview");
  });
  it("rejects non-image uploads", async () => {
    render(<TractorPhotoPicker tractor={tractor} />);
    fireEvent.change(screen.getByLabelText("Upload tractor image"), { target: { files: [new File(["bad"], "file.svg", { type: "image/svg+xml" })] } });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByAltText("Tractor photo preview")).toBeNull();
  });
});