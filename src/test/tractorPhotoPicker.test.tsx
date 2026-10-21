import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TractorPhotoPicker from "@/components/equipment/TractorPhotoPicker";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("tractor photo picker safety", () => {
  it("offers only upload — no search buttons or external links", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<TractorPhotoPicker />);
    expect(screen.getByRole("button", { name: "Upload image" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /search/i })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/google/i)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("previews an uploaded photo without any network or equipment writes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:preview", revokeObjectURL: revoke });
    vi.stubGlobal("Image", class { onload?: () => void; set src(_value: string) { this.onload?.(); } });
    render(<TractorPhotoPicker />);
    fireEvent.change(screen.getByLabelText("Upload tractor image"), { target: { files: [new File(["photo"], "tractor.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByAltText("Tractor photo preview")).toHaveAttribute("src", "blob:preview"));
    expect(screen.getByText("tractor.png")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove photo preview" }));
    expect(revoke).toHaveBeenCalledWith("blob:preview");
    expect(screen.queryByAltText("Tractor photo preview")).toBeNull();
  });
  it("rejects non-image uploads", async () => {
    render(<TractorPhotoPicker />);
    fireEvent.change(screen.getByLabelText("Upload tractor image"), { target: { files: [new File(["bad"], "file.svg", { type: "image/svg+xml" })] } });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByAltText("Tractor photo preview")).toBeNull();
  });
  it("says the photo is preview only and not saved", () => {
    render(<TractorPhotoPicker />);
    expect(screen.getByText(/preview only — photos are not saved/i)).toBeInTheDocument();
  });
});
