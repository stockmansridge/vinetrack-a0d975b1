// Newsletter block model + starter templates (Portal editor side).
//
// The email HTML is rendered SERVER-SIDE by
// supabase/functions/_shared/newsletter/render.ts — the one rendering engine
// used for preview, test sends and real sends. This module only describes the
// editable shape of a newsletter.

export type NewsletterBlockType =
  | "hero"
  | "feature"
  | "text"
  | "cards"
  | "button"
  | "divider"
  | "footer";

export interface NewsletterImageRef {
  /** Durable public URL (guide-images bucket) — never a blob:/data: URL. */
  url?: string | null;
  alt?: string | null;
  /** Storage object path, kept so the image can be replaced or removed. */
  path?: string | null;
}

export interface NewsletterCardBlock {
  image?: NewsletterImageRef | null;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

export interface NewsletterBlock {
  id: string;
  type: NewsletterBlockType;
  image?: NewsletterImageRef | null;
  eyebrow?: string;
  heading?: string;
  body?: string;
  bullets?: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  align?: "left" | "center";
  layout?: "image-left" | "image-right";
  /** Legacy two-choice background; still honoured by the renderer. */
  background?: "white" | "soft" | string;
  /** Colour preset key (see palette.ts) or #hex. Saved in the block JSON and
   *  frozen into the sent version; rendered as inline email styles. */
  bgColor?: string;
  textColor?: string;
  buttonBgColor?: string;
  buttonTextColor?: string;
  cards?: NewsletterCardBlock[];
}

export const BLOCK_LABELS: Record<NewsletterBlockType, string> = {
  hero: "Hero",
  feature: "Image + text feature",
  text: "Text section",
  cards: "Three cards",
  button: "Button",
  divider: "Divider",
  footer: "Footer",
};

export const ADDABLE_BLOCKS: NewsletterBlockType[] = [
  "hero",
  "feature",
  "text",
  "cards",
  "button",
  "divider",
  "footer",
];

let counter = 0;
export function newBlockId(): string {
  counter += 1;
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : String(Math.random()).slice(2, 10);
  return `b_${Date.now().toString(36)}_${counter}_${rand}`;
}

export function emptyBlock(type: NewsletterBlockType): NewsletterBlock {
  const base: NewsletterBlock = { id: newBlockId(), type, background: "white", bgColor: "white" };
  switch (type) {
    case "hero":
      return { ...base, eyebrow: "", heading: "What's new in VineTrack", body: "", align: "left" };
    case "feature":
      return { ...base, heading: "", body: "", bullets: [], layout: "image-left" };
    case "text":
      return { ...base, heading: "", body: "", bullets: [], align: "left" };
    case "cards":
      return {
        ...base,
        heading: "",
        cards: [
          { heading: "", body: "", ctaLabel: "", ctaUrl: "" },
          { heading: "", body: "", ctaLabel: "", ctaUrl: "" },
          { heading: "", body: "", ctaLabel: "", ctaUrl: "" },
        ],
      };
    case "button":
      return { ...base, ctaLabel: "Open VineTrack", ctaUrl: "https://portal.vinetrack.com.au", align: "left" };
    case "divider":
      return base;
    case "footer":
      return { ...base, body: "" };
    default:
      return base;
  }
}

export interface NewsletterTemplate {
  key: string;
  label: string;
  description: string;
  name: string;
  subject: string;
  preheader: string;
  blocks: NewsletterBlock[];
}

function feature(
  heading: string,
  body: string,
  bullets: string[],
  layout: "image-left" | "image-right",
  bgColor: string,
  textColor?: string,
): NewsletterBlock {
  return {
    id: newBlockId(),
    type: "feature",
    heading,
    body,
    bullets,
    layout,
    background: bgColor === "white" ? "white" : "soft",
    bgColor,
    textColor,
  };
}

export function productUpdateTemplate(): NewsletterTemplate {
  return {
    key: "product_update",
    label: "Product Update",
    description: "Hero, four features and a three-card section — the standard VineTrack update.",
    name: "VineTrack product update",
    subject: "What's new in VineTrack",
    preheader: "New vineyard tools, major spray upgrades and better field observations.",
    blocks: [
      {
        id: newBlockId(),
        type: "hero",
        eyebrow: "Product update",
        heading: "What's new in VineTrack",
        body: "A round-up of the latest improvements across the app, the Portal and the website.",
        align: "left",
        background: "white",
        bgColor: "white",
        textColor: "ink",
        buttonBgColor: "green",
        buttonTextColor: "white",
        ctaLabel: "Open the Portal",
        ctaUrl: "https://portal.vinetrack.com.au",
      },
      feature(
        "More vineyard tools",
        "New tools to plan, record and review work across every block.",
        ["Faster block setup", "Clearer paddock summaries", "Better records on the go"],
        "image-left",
        "white",
      ),
      feature(
        "Major Spray upgrades",
        "Spray planning, trip worksheets and reporting have all had a serious lift.",
        ["Multi-tank manual entry", "Safer corrections with a full audit trail", "Multi-page spray reports"],
        "image-right",
        "soft",
      ),
      feature(
        "Better field observations",
        "Capture what you see in the vineyard with far less typing.",
        ["Pin colours shared across every device", "Growth stage capture", "Photos attached to records"],
        "image-left",
        "white",
      ),
      feature(
        "Understand your season",
        "Season-wide numbers you can act on, not just data you have to read.",
        ["Yield estimates", "Damage adjustments", "Cost reporting"],
        "image-right",
        "deep",
        "white",
      ),
      {
        id: newBlockId(),
        type: "cards",
        eyebrow: "More from VineTrack",
        heading: "Explore VineTrack",
        background: "soft",
        bgColor: "soft",
        textColor: "deep",
        cards: [
          {
            heading: "VineTrack Portal",
            body: "Plan, report and manage your vineyard from a bigger screen.",
            ctaLabel: "Open Portal",
            ctaUrl: "https://portal.vinetrack.com.au",
          },
          {
            heading: "New website",
            body: "See what VineTrack does and share it with your team.",
            ctaLabel: "Visit site",
            ctaUrl: "https://www.vinetrack.com.au",
          },
          {
            heading: "Feature requests",
            body: "Tell us what to build next and vote on other growers' ideas.",
            ctaLabel: "Add a request",
            ctaUrl: "https://portal.vinetrack.com.au/feature-requests",
          },
        ],
      },
      { id: newBlockId(), type: "footer", body: "" },
    ],
  };
}

export function blankTemplate(): NewsletterTemplate {
  return {
    key: "blank",
    label: "Blank newsletter",
    description: "Start with a hero and a footer, then add the blocks you want.",
    name: "New newsletter",
    subject: "",
    preheader: "",
    blocks: [emptyBlock("hero"), emptyBlock("footer")],
  };
}

export function newsletterTemplates(): NewsletterTemplate[] {
  return [productUpdateTemplate(), blankTemplate()];
}

/** Add / delete / duplicate / move — pure helpers so they are testable. */
export function addBlock(blocks: NewsletterBlock[], type: NewsletterBlockType): NewsletterBlock[] {
  const next = [...blocks];
  const footerIndex = next.findIndex((b) => b.type === "footer");
  const block = emptyBlock(type);
  if (type !== "footer" && footerIndex >= 0) next.splice(footerIndex, 0, block);
  else next.push(block);
  return next;
}

export function removeBlock(blocks: NewsletterBlock[], id: string): NewsletterBlock[] {
  return blocks.filter((b) => b.id !== id);
}

export function duplicateBlock(blocks: NewsletterBlock[], id: string): NewsletterBlock[] {
  const index = blocks.findIndex((b) => b.id === id);
  if (index < 0) return blocks;
  const copy: NewsletterBlock = JSON.parse(JSON.stringify(blocks[index]));
  copy.id = newBlockId();
  const next = [...blocks];
  next.splice(index + 1, 0, copy);
  return next;
}

export function moveBlock(blocks: NewsletterBlock[], id: string, delta: number): NewsletterBlock[] {
  const index = blocks.findIndex((b) => b.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= blocks.length) return blocks;
  const next = [...blocks];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export function updateBlock(
  blocks: NewsletterBlock[],
  id: string,
  patch: Partial<NewsletterBlock>,
): NewsletterBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
}
