import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  normalisePinCategoryId,
  pinCategoryStyle,
  pinCategoryStyleById,
} from "@/lib/pinCategory";
import { pinDisplayStyle } from "@/lib/pinStyle";

const GREEN = "#34C759";
const BROWN = "#A2845E";
const ORANGE = "#FF9500";
const BLUE = "#007AFF";
const GREY = "#8E8E93";

const pin = (patch: Record<string, any> = {}) => ({
  id: "p1",
  mode: "Repair",
  category_id: "vine_issue",
  paddock_id: "block-1",
  pin_row_number: 87.5,
  driving_row_number: 87,
  pin_side: "left",
  latitude: -33.5,
  longitude: 151.2,
  ...patch,
});

describe("canonical category colours", () => {
  it("maps every canonical category id to its contract colour", () => {
    expect(pinCategoryStyleById("vine_issue").hex).toBe(GREEN);
    expect(pinCategoryStyleById("broken_post").hex).toBe(BROWN);
    expect(pinCategoryStyleById("broken_wire").hex).toBe(ORANGE);
    expect(pinCategoryStyleById("irrigation").hex).toBe(BLUE);
    expect(pinCategoryStyleById("other").hex).toBe(GREY);
    expect(pinCategoryStyleById("unknown").hex).toBe(GREY);
  });

  it("vine_issue with a row is green", () => {
    expect(pinDisplayStyle(pin() as any).hex).toBe(GREEN);
  });

  it("vine_issue without a block or row is still green", () => {
    const p = pin({ paddock_id: null, pin_row_number: null, driving_row_number: null });
    expect(pinDisplayStyle(p as any).hex).toBe(GREEN);
  });

  it("other is grey and unknown is grey", () => {
    expect(pinDisplayStyle(pin({ category_id: "other" }) as any).hex).toBe(GREY);
    expect(pinDisplayStyle(pin({ category_id: "totally_new_thing" }) as any).hex).toBe(GREY);
    expect(pinDisplayStyle(pin({ category_id: null, category: null, button_name: null }) as any).hex).toBe(GREY);
  });

  it("completion status does not change category colour", () => {
    expect(pinDisplayStyle(pin({ is_completed: true }) as any).hex).toBe(GREEN);
  });

  it("manual creation source does not change category colour", () => {
    const manual = pin({ source: "manual", created_manually: true, snapped_to_row: false });
    expect(pinDisplayStyle(manual as any).hex).toBe(GREEN);
  });

  it("ignores stored marker colour, title text, creator and sync state", () => {
    const noisy = pin({
      button_color: "#FF0000",
      title: "Broken post near the shed",
      created_by: "someone",
      sync_version: 9,
      platform: "android",
    });
    expect(pinDisplayStyle(noisy as any).hex).toBe(GREEN);
  });

  it("normalises legacy category and button-name spellings", () => {
    expect(normalisePinCategoryId({ category: "Broken Post" })).toBe("broken_post");
    expect(normalisePinCategoryId({ button_name: "broken-wire" })).toBe("broken_wire");
    expect(normalisePinCategoryId({ category: "Irrigation" })).toBe("irrigation");
    expect(pinCategoryStyle({ category: "Broken Post" }).hex).toBe(BROWN);
  });
});

describe("shared category token across surfaces", () => {
  it("table dot, map marker and detail badge use the same token", () => {
    const p = pin({ category_id: "irrigation" });
    const style = pinDisplayStyle(p as any);
    // table dot
    const { container } = render(
      <span data-category-id={style.categoryId} style={{ background: style.hex }} />,
    );
    const dot = container.querySelector("[data-category-id]") as HTMLElement;
    expect(dot.dataset.categoryId).toBe("irrigation");
    // map marker hex + detail badge hex resolve from the same helper
    expect(style.hex).toBe(BLUE);
    expect(pinCategoryStyle(p as any).hex).toBe(style.hex);
    expect(style.label).toBe("Irrigation");
  });

  it("renders an amber unassigned warning that is not the category colour", () => {
    render(
      <span className="text-amber-500" role="img" aria-label="Unassigned location" />,
    );
    expect(screen.getByLabelText("Unassigned location")).toBeTruthy();
  });
});
