import { describe, expect, it } from "vitest";
import {
  renderNewsletterHtml,
  renderNewsletterText,
  safeUrl,
  type NewsletterBlock,
} from "../../supabase/functions/_shared/newsletter/render";
import {
  addBlock,
  blankTemplate,
  duplicateBlock,
  moveBlock,
  productUpdateTemplate,
  removeBlock,
  updateBlock,
} from "@/lib/newsletter/blocks";
import { isDurableImageUrl } from "@/lib/newsletter/imageUpload";

const blocks: NewsletterBlock[] = [
  {
    id: "1",
    type: "hero",
    heading: "What's new",
    body: "Line one\n\nLine two",
    ctaLabel: "Open",
    ctaUrl: "https://portal.vinetrack.com.au",
    image: { url: "https://cdn.example.com/hero.png", alt: "Hero" },
  },
  { id: "2", type: "feature", heading: "Sprays", body: "Better", bullets: ["One", "Two"] },
  { id: "3", type: "divider" },
  { id: "4", type: "footer" },
];

describe("newsletter rendering", () => {
  const html = renderNewsletterHtml({ subject: "What's new in VineTrack", preheader: "Hi", blocks });

  it("produces a standalone, table-based, mobile-ready email", () => {
    expect(html).toContain("<!DOCTYPE html");
    expect(html).toContain('name="viewport"');
    expect(html).toContain("@media only screen and (max-width:620px)");
    expect(html).toContain("max-width:640px");
    expect(html).not.toMatch(/display:\s*flex/i);
    expect(html).not.toMatch(/display:\s*grid/i);
    expect(html).not.toContain("var(--");
  });

  it("includes content, the preheader and an unsubscribe instruction", () => {
    expect(html).toContain("What&#39;s new");
    expect(html).toContain("Hi");
    expect(html).toContain("https://portal.vinetrack.com.au");
    expect(html.toLowerCase()).toContain("unsubscribe");
    expect(html).toContain("Account and billing emails are sent separately");
  });

  it("adds the standard footer even when the admin deleted the footer block", () => {
    const withoutFooter = renderNewsletterHtml({
      subject: "S",
      blocks: blocks.filter((b) => b.type !== "footer"),
    });
    expect(withoutFooter.toLowerCase()).toContain("unsubscribe");
  });

  it("escapes content and rejects unsafe links", () => {
    const evil = renderNewsletterHtml({
      subject: "x",
      blocks: [
        {
          id: "1",
          type: "button",
          ctaLabel: "<script>alert(1)</script>",
          ctaUrl: "javascript:alert(1)",
        },
      ],
    });
    expect(evil).not.toContain("<script>");
    expect(evil).not.toContain("javascript:");
    expect(safeUrl("https://ok.example.com")).toBe("https://ok.example.com");
    expect(safeUrl("data:text/html,x")).toBeNull();
  });

  it("marks a test send in the body", () => {
    const test = renderNewsletterHtml({ subject: "x", blocks, isTest: true });
    expect(test).toContain("Test send");
    expect(renderNewsletterText({ subject: "x", blocks, isTest: true })).toContain("[TEST SEND]");
  });

  it("only stores durable image URLs", () => {
    expect(isDurableImageUrl("https://cdn.example.com/a.png")).toBe(true);
    expect(isDurableImageUrl("blob:http://localhost/abc")).toBe(false);
    expect(isDurableImageUrl("data:image/png;base64,AAA")).toBe(false);
    expect(isDurableImageUrl("https://example.com/storage/v1/object/sign/logos/a.png?token=abc")).toBe(false);
    expect(isDurableImageUrl("https://example.com/logo.png?token=abc")).toBe(false);
    expect(isDurableImageUrl("")).toBe(false);
    // An uploaded image survives a save/reload cycle because only its public URL
    // is persisted in the campaign blocks.
    const saved = JSON.parse(JSON.stringify(blocks)) as NewsletterBlock[];
    expect(saved[0].image?.url).toBe("https://cdn.example.com/hero.png");
    expect(renderNewsletterHtml({ subject: "x", blocks: saved })).toContain(
      "https://cdn.example.com/hero.png",
    );
  });

  it("uses one custom durable logo and alt text in the header and footer", () => {
    const htmlWithLogo = renderNewsletterHtml({
      subject: "Custom brand",
      blocks,
      logoUrl: "https://cdn.example.com/vinetrack-correct.png",
      logoAlt: "VineTrack vineyard management",
    });
    expect(htmlWithLogo.match(/https:\/\/cdn\.example\.com\/vinetrack-correct\.png/g)).toHaveLength(2);
    expect(htmlWithLogo.match(/alt="VineTrack vineyard management"/g)).toHaveLength(2);
  });

  it("renders hero, feature and card images at the full width of their image areas", () => {
    const imageUrl = "https://cdn.example.com/full-width.png";
    const imageBlocks: NewsletterBlock[] = [
      { id: "hero", type: "hero", heading: "Hero", image: { url: imageUrl, alt: "Hero" } },
      { id: "feature", type: "feature", heading: "Feature", layout: "image-right", image: { url: imageUrl, alt: "Feature" } },
      {
        id: "cards",
        type: "cards",
        cards: [{ heading: "Card", image: { url: imageUrl, alt: "Card" } }],
      },
    ];
    const rendered = renderNewsletterHtml({ subject: "Images", blocks: imageBlocks });

    expect(rendered).toContain('padding:0;background-color:');
    expect(rendered).toContain('class="vt-col vt-feature-image" width="45%"');
    expect(rendered).toContain('dir="rtl"');
    expect(rendered).toContain('padding:0;overflow:hidden;border-radius:13px 13px 0 0;');
    expect(rendered.match(/width="100%" style="display:block;width:100%;max-width:100%/g)).toHaveLength(3);
    expect(rendered).toContain(".vt-feature-image { display:table-header-group !important; width:100% !important; }");
  });

  it("renders the plain-text alternative from the same blocks", () => {
    const text = renderNewsletterText({ subject: "Sub", blocks });
    expect(text).toContain("Sub");
    expect(text).toContain("- One");
    expect(text.toLowerCase()).toContain("unsubscribe");
  });
});

describe("block editing helpers", () => {
  it("the Product Update template has the expected structure", () => {
    const tpl = productUpdateTemplate();
    expect(tpl.blocks[0].type).toBe("hero");
    expect(tpl.blocks.filter((b) => b.type === "feature")).toHaveLength(4);
    expect(tpl.blocks.some((b) => b.type === "cards")).toBe(true);
    expect(tpl.blocks[tpl.blocks.length - 1].type).toBe("footer");
    expect(blankTemplate().blocks.map((b) => b.type)).toEqual(["hero", "footer"]);
  });

  it("adds new blocks above the footer, duplicates, moves and deletes", () => {
    const tpl = blankTemplate();
    const added = addBlock(tpl.blocks, "text");
    expect(added.map((b) => b.type)).toEqual(["hero", "text", "footer"]);

    const duped = duplicateBlock(added, added[1].id);
    expect(duped).toHaveLength(4);
    expect(duped[2].id).not.toBe(duped[1].id);

    const moved = moveBlock(added, added[1].id, -1);
    expect(moved.map((b) => b.type)).toEqual(["text", "hero", "footer"]);
    expect(moveBlock(added, added[0].id, -1)).toEqual(added);

    const patched = updateBlock(added, added[1].id, { heading: "Hello" });
    expect(patched[1].heading).toBe("Hello");

    expect(removeBlock(added, added[1].id).map((b) => b.type)).toEqual(["hero", "footer"]);
  });
});
