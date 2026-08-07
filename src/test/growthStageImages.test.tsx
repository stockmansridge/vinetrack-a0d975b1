// Growth Stage picker imagery — mapping.json wiring, neutral placeholders,
// ordering, selection persistence and accessibility.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GrowthStagePickerDialog from "@/components/pins/GrowthStagePickerDialog";
import { GROWTH_STAGES } from "@/lib/vspWaterRate";
import {
  GROWTH_STAGE_IMAGES,
  GROWTH_STAGES_WITHOUT_IMAGE,
  growthStageImageUrl,
} from "@/lib/growthStageImages";

const WITH_IMAGE = [
  "EL1", "EL2", "EL3", "EL4", "EL7", "EL9", "EL11", "EL12", "EL17", "EL19", "EL21",
  "EL23", "EL25", "EL27", "EL29", "EL31", "EL33", "EL35", "EL38", "EL41", "EL47",
];

describe("growth stage image mapping", () => {
  it("maps exactly the 21 image-backed E-L codes", () => {
    expect(GROWTH_STAGE_IMAGES.map((i) => i.code)).toEqual(WITH_IMAGE);
    for (const code of WITH_IMAGE) {
      expect(growthStageImageUrl(code)).toBe(`/growth-stages/${code.toLowerCase()}.webp`);
    }
  });

  it("returns no image for the intentionally image-less stages", () => {
    expect(GROWTH_STAGES_WITHOUT_IMAGE).toEqual([
      "EL13", "EL14", "EL15", "EL16", "EL18", "EL20", "EL26", "EL32", "EL34", "EL36", "EL37", "EL39", "EL43",
    ]);
    for (const code of GROWTH_STAGES_WITHOUT_IMAGE) {
      expect(growthStageImageUrl(code)).toBeNull();
    }
  });

  it("never reuses another stage's image and covers every catalogue code", () => {
    const files = GROWTH_STAGE_IMAGES.map((i) => i.file);
    expect(new Set(files).size).toBe(files.length);
    const known = new Set([...WITH_IMAGE, ...GROWTH_STAGES_WITHOUT_IMAGE]);
    expect(GROWTH_STAGES.map((s) => s.code).filter((c) => !known.has(c))).toEqual([]);
  });
});

function renderPicker(onSelect = vi.fn()) {
  render(<GrowthStagePickerDialog open onOpenChange={() => {}} onSelect={onSelect} />);
  return onSelect;
}

describe("GrowthStagePickerDialog tiles", () => {
  it("keeps the shared GROWTH_STAGES ordering", () => {
    renderPicker();
    const rendered = screen
      .getAllByRole("button", { name: /^Growth stage EL/ })
      .map((b) => b.getAttribute("aria-label")!.replace("Growth stage ", ""));
    expect(rendered).toEqual(GROWTH_STAGES.map((s) => s.code));
  });

  it("shows the mapped image with descriptive alt text", () => {
    renderPicker();
    const tile = screen.getByRole("button", { name: "Growth stage EL23" });
    const img = tile.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/growth-stages/el23.webp");
    expect(img.getAttribute("alt")).toContain("EL23 reference photo");
    expect(tile.textContent).toContain("EL23");
    expect(tile.textContent).toContain("50% caps off");
  });

  it("falls back to a neutral placeholder tile for image-less stages", () => {
    renderPicker();
    const tile = screen.getByRole("button", { name: "Growth stage EL26" });
    expect(tile.querySelector("img")).toBeNull();
    expect(screen.getByTestId("growth-stage-placeholder-EL26")).toBeTruthy();
    expect(tile.textContent).toContain("Cap-fall complete");
  });

  it("persists the selected E-L code unchanged", () => {
    const onSelect = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Growth stage EL38" }));
    fireEvent.click(screen.getByText("Use stage"));
    expect(onSelect).toHaveBeenCalledWith("EL38");
  });
});
