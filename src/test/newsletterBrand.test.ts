import { describe, expect, it } from "vitest";
import {
  BACKGROUND_PRESETS,
  BRAND,
  BUTTON_BG_PRESETS,
  BUTTON_TEXT_PRESETS,
  EMAIL_FONT_STACK,
  TEXT_PRESETS,
  contrastRatio,
  renderNewsletterHtml,
  type NewsletterBlock,
} from "../../supabase/functions/_shared/newsletter/render";
import {
  BACKGROUND_OPTIONS,
  BUTTON_BACKGROUND_OPTIONS,
  BUTTON_TEXT_OPTIONS,
  NEWSLETTER_BRAND,
  NEWSLETTER_EMAIL_FONT,
  TEXT_OPTIONS,
  colourHex,
  contrast,
  contrastWarning,
  isValidHexColour,
} from "@/lib/newsletter/palette";
import { productUpdateTemplate } from "@/lib/newsletter/blocks";

describe("newsletter palette mirror", () => {
  it("Portal presets match the renderer presets exactly", () => {
    expect(BACKGROUND_OPTIONS).toEqual(BACKGROUND_PRESETS);
    expect(TEXT_OPTIONS).toEqual(TEXT_PRESETS);
    expect(BUTTON_BACKGROUND_OPTIONS).toEqual(BUTTON_BG_PRESETS);
    expect(BUTTON_TEXT_OPTIONS).toEqual(BUTTON_TEXT_PRESETS);
    expect(BRAND).toMatchObject(NEWSLETTER_BRAND);
    expect(NEWSLETTER_EMAIL_FONT).toBe(EMAIL_FONT_STACK);
  });

  it("uses the website brand hexes, not invented greens", () => {
    expect(BRAND.green).toBe("#2A7140");
    expect(BRAND.greenDark).toBe("#134323");
  });

  it("resolves presets and validated hex, ignoring junk", () => {
    expect(colourHex(BACKGROUND_OPTIONS, "deep", "#FFFFFF")).toBe("#134323");
    expect(colourHex(BACKGROUND_OPTIONS, "#abc", "#FFFFFF")).toBe("#ABC");
    expect(colourHex(BACKGROUND_OPTIONS, "not-a-colour", "#FFFFFF")).toBe("#FFFFFF");
    expect(isValidHexColour("#2A7140")).toBe(true);
    expect(isValidHexColour("2A7140")).toBe(false);
  });

  it("contrast maths agrees with the renderer", () => {
    expect(contrast("#FFFFFF", "#1A2C30")).toBeCloseTo(contrastRatio("#FFFFFF", "#1A2C30"), 5);
  });

  it("warns on poor combinations instead of changing them", () => {
    expect(contrastWarning("#FFFFFF", "#1A2C30")).toBeNull();
    expect(contrastWarning("#134323", "#2A7140")).toBeTruthy();
  });
});

describe("Product Update visual fixture", () => {
  const tpl = productUpdateTemplate();
  const blocks = tpl.blocks as NewsletterBlock[];
  const html = renderNewsletterHtml({
    subject: tpl.subject,
    preheader: tpl.preheader,
    blocks,
  });

  it("starts from the approved structure", () => {
    const types = blocks.map((b) => b.type);
    expect(types.slice(0, 6)).toEqual(["hero", "feature", "feature", "feature", "feature", "cards"]);
    const layouts = blocks.filter((b) => b.type === "feature").map((b) => b.layout);
    expect(layouts).toEqual(["image-left", "image-right", "image-left", "image-right"]);
  });

  it("carries white, soft green and deep green blocks with white text", () => {
    const bgs = blocks.map((b) => b.bgColor);
    expect(bgs).toContain("white");
    expect(bgs).toContain("soft");
    expect(bgs).toContain("deep");
    const deep = blocks.find((b) => b.bgColor === "deep");
    expect(deep?.textColor).toBe("white");
    expect(html).toContain("#134323");
  });

  it("renders the standard header with logo and tagline", () => {
    expect(html).toContain("Built by viticulturists, for viticulturists.");
    expect(html).toContain("newsletter/branding/vinetrack-logo.png");
    expect(html).toContain('alt="VineTrack"');
  });

  it("renders the branded footer with compliance links that need no image", () => {
    expect(html).toContain("Thanks for being part of VineTrack.");
    expect(html).toContain("Jonathan");
    // The unsubscribe MECHANISM stays with the email provider, which injects the
    // link/header on every marketing send; the footer only labels it.
    expect(html).toContain("Unsubscribe");
    expect(html).toContain("unsubscribe link at the bottom of this email");
  });

  it("stays conservative and email-safe", () => {
    expect(html).not.toMatch(/display:\s*flex/i);
    expect(html).not.toMatch(/display:\s*grid/i);
    expect(html).not.toContain("oklch");
    expect(html).not.toContain("var(--");
    expect(html).not.toContain("<link");
    expect(html).toContain("'Inter',Arial,Helvetica,sans-serif");
    expect(html).toContain("max-width:640px");
  });

  it("honours per-block custom hex colours inline", () => {
    const custom = renderNewsletterHtml({
      subject: "x",
      blocks: [{ id: "1", type: "text", heading: "Hi", body: "There", bgColor: "#123456", textColor: "#FEDCBA" }],
    });
    expect(custom).toContain("#123456");
    expect(custom).toContain("#FEDCBA");
  });
});
