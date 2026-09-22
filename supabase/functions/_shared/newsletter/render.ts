// VineTrack newsletter email renderer — the ONE rendering engine.
//
// Used by:
//   * admin-newsletters  (preview + test send)
//   * admin-newsletter-send (real send, frozen into the version snapshot)
//   * src/test/newsletterRender.test.ts
//
// Deliberately dependency-free, email-client-safe HTML: nested tables, inline
// styles, no flexbox/grid, no CSS variables, no web fonts. Max width 640px.
// The Portal preview renders exactly this HTML in an iframe, so what the admin
// sees is what is sent.

export const BRAND = {
  green: "#2E7D4F",
  greenDark: "#14532D",
  soft: "#F1F7F2",
  border: "#DCE7DE",
  text: "#1F2937",
  muted: "#55635A",
  white: "#FFFFFF",
  page: "#F6F8F6",
  maxWidth: 640,
} as const;

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export type BlockType =
  | "hero"
  | "feature"
  | "text"
  | "cards"
  | "button"
  | "divider"
  | "footer";

export interface NewsletterImage {
  url?: string | null;
  alt?: string | null;
}

export interface NewsletterCard {
  image?: NewsletterImage | null;
  heading?: string | null;
  body?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
}

export interface NewsletterBlock {
  id: string;
  type: BlockType;
  image?: NewsletterImage | null;
  eyebrow?: string | null;
  heading?: string | null;
  body?: string | null;
  bullets?: string[] | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  align?: "left" | "center" | null;
  layout?: "image-left" | "image-right" | null;
  background?: "white" | "soft" | null;
  cards?: NewsletterCard[] | null;
}

export interface RenderOptions {
  subject: string;
  preheader?: string | null;
  blocks: NewsletterBlock[];
  /** Absolute URL used in the footer's "view in browser"/site link. */
  siteUrl?: string;
  /** Shown in the footer. */
  senderName?: string;
  supportEmail?: string;
  /** Marked in the rendered body so a test is obvious to the admin. */
  isTest?: boolean;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s) and mailto links survive — never javascript:/data:. */
export function safeUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^(https?:\/\/|mailto:)/i.test(raw)) return null;
  return escapeHtml(raw);
}

function paragraphs(body: string | null | undefined, align: string): string {
  const text = String(body ?? "").trim();
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p style="margin:0 0 14px 0;font-family:${FONT};font-size:16px;line-height:26px;color:${BRAND.text};text-align:${align};">${escapeHtml(
          para,
        ).replace(/\n/g, "<br />")}</p>`,
    )
    .join("");
}

function bulletList(bullets: string[] | null | undefined): string {
  const items = (bullets ?? []).map((b) => String(b ?? "").trim()).filter(Boolean);
  if (items.length === 0) return "";
  const lis = items
    .map(
      (item) =>
        `<li style="margin:0 0 8px 0;font-family:${FONT};font-size:16px;line-height:25px;color:${BRAND.text};">${escapeHtml(
          item,
        )}</li>`,
    )
    .join("");
  return `<ul style="margin:0 0 14px 0;padding-left:22px;">${lis}</ul>`;
}

function button(label: string | null | undefined, url: unknown, align = "left"): string {
  const text = String(label ?? "").trim();
  const href = safeUrl(url);
  if (!text || !href) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="margin:6px 0 2px 0;"><tr><td bgcolor="${BRAND.green}" style="border-radius:8px;">
<a href="${href}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;">${escapeHtml(
    text,
  )}</a></td></tr></table><div style="clear:both;line-height:0;">&nbsp;</div>`;
}

function image(img: NewsletterImage | null | undefined, width = BRAND.maxWidth - 64): string {
  const url = safeUrl(img?.url);
  if (!url) return "";
  return `<img src="${url}" alt="${escapeHtml(img?.alt ?? "")}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:10px;" />`;
}

function eyebrow(value: string | null | undefined, align: string): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${BRAND.green};text-align:${align};">${escapeHtml(
    text,
  )}</p>`;
}

function heading(value: string | null | undefined, align: string, size = 26): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return `<h2 style="margin:0 0 12px 0;font-family:${FONT};font-size:${size}px;line-height:${
    size + 8
  }px;font-weight:700;color:${BRAND.greenDark};text-align:${align};">${escapeHtml(text)}</h2>`;
}

function section(inner: string, background: "white" | "soft" = "white"): string {
  const bg = background === "soft" ? BRAND.soft : BRAND.white;
  return `<tr><td bgcolor="${bg}" style="padding:28px 32px;background-color:${bg};">${inner}</td></tr>`;
}

function renderHero(block: NewsletterBlock): string {
  const align = block.align === "center" ? "center" : "left";
  const inner = [
    image(block.image),
    block.image?.url ? `<div style="height:20px;line-height:20px;">&nbsp;</div>` : "",
    eyebrow(block.eyebrow, align),
    heading(block.heading, align, 30),
    paragraphs(block.body, align),
    button(block.ctaLabel, block.ctaUrl, align),
  ].join("");
  return section(inner, block.background === "soft" ? "soft" : "white");
}

function renderFeature(block: NewsletterBlock): string {
  const align = "left";
  const textCol = [
    eyebrow(block.eyebrow, align),
    heading(block.heading, align, 22),
    paragraphs(block.body, align),
    bulletList(block.bullets),
    button(block.ctaLabel, block.ctaUrl, align),
  ].join("");
  const imgCol = image(block.image, 240);
  if (!imgCol) return section(textCol, block.background === "soft" ? "soft" : "white");
  const imageLeft = block.layout !== "image-right";
  // Stacks on narrow screens because each column is a full-width table cell
  // inside a media-query-aware wrapper class.
  const left = imageLeft ? imgCol : textCol;
  const right = imageLeft ? textCol : imgCol;
  const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="vt-col" width="45%" valign="top" style="padding:0 12px 0 0;">${left}</td>
<td class="vt-col" width="55%" valign="top" style="padding:0 0 0 12px;">${right}</td>
</tr></table>`;
  return section(inner, block.background === "soft" ? "soft" : "white");
}

function renderText(block: NewsletterBlock): string {
  const align = block.align === "center" ? "center" : "left";
  const inner = [
    eyebrow(block.eyebrow, align),
    heading(block.heading, align, 22),
    paragraphs(block.body, align),
    bulletList(block.bullets),
  ].join("");
  return section(inner, block.background === "soft" ? "soft" : "white");
}

function renderCards(block: NewsletterBlock): string {
  const cards = (block.cards ?? []).slice(0, 3);
  if (cards.length === 0) return "";
  const cells = cards
    .map((card) => {
      const inner = [
        image(card.image, 160),
        card.image?.url ? `<div style="height:12px;line-height:12px;">&nbsp;</div>` : "",
        heading(card.heading, "left", 17),
        paragraphs(card.body, "left"),
        button(card.ctaLabel, card.ctaUrl, "left"),
      ].join("");
      return `<td class="vt-col" valign="top" width="33.33%" style="padding:6px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.white}" style="border:1px solid ${BRAND.border};border-radius:12px;">
<tr><td style="padding:16px;">${inner}</td></tr></table></td>`;
    })
    .join("");
  const inner = [
    heading(block.heading, "left", 22),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`,
  ].join("");
  return section(inner, block.background === "soft" ? "soft" : "white");
}

function renderButton(block: NewsletterBlock): string {
  const align = block.align === "center" ? "center" : "left";
  const inner = button(block.ctaLabel, block.ctaUrl, align);
  if (!inner) return "";
  return section(inner, block.background === "soft" ? "soft" : "white");
}

function renderDivider(): string {
  return `<tr><td bgcolor="${BRAND.white}" style="padding:4px 32px;background-color:${BRAND.white};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" bgcolor="${BRAND.border}" style="height:1px;line-height:1px;font-size:0;">&nbsp;</td></tr></table></td></tr>`;
}

function renderFooter(block: NewsletterBlock, opts: RenderOptions): string {
  const site = safeUrl(opts.siteUrl ?? "https://www.vinetrack.com.au");
  const support = escapeHtml(opts.supportEmail ?? "support@vinetrack.com.au");
  const extra = String(block.body ?? "").trim();
  return `<tr><td bgcolor="${BRAND.soft}" style="padding:26px 32px;background-color:${BRAND.soft};border-top:1px solid ${BRAND.border};">
<p style="margin:0 0 10px 0;font-family:${FONT};font-size:14px;line-height:22px;font-weight:700;color:${BRAND.greenDark};">VineTrack</p>
${
    extra
      ? `<p style="margin:0 0 10px 0;font-family:${FONT};font-size:13px;line-height:21px;color:${BRAND.muted};">${escapeHtml(
          extra,
        )}</p>`
      : ""
  }
<p style="margin:0 0 10px 0;font-family:${FONT};font-size:13px;line-height:21px;color:${BRAND.muted};">Vineyard management software for growers.${
    site ? ` <a href="${site}" style="color:${BRAND.green};text-decoration:underline;">vinetrack.com.au</a>` : ""
  }</p>
<p style="margin:0;font-family:${FONT};font-size:12px;line-height:20px;color:${BRAND.muted};">You are receiving this because you use VineTrack or subscribed to VineTrack updates. Questions? <a href="mailto:${support}" style="color:${BRAND.green};text-decoration:underline;">${support}</a><br />To stop receiving VineTrack newsletters, use the unsubscribe link at the bottom of this email. Account and billing emails are sent separately and are not affected.</p>
</td></tr>`;
}

function renderBlock(block: NewsletterBlock, opts: RenderOptions): string {
  switch (block.type) {
    case "hero":
      return renderHero(block);
    case "feature":
      return renderFeature(block);
    case "text":
      return renderText(block);
    case "cards":
      return renderCards(block);
    case "button":
      return renderButton(block);
    case "divider":
      return renderDivider();
    case "footer":
      return renderFooter(block, opts);
    default:
      return "";
  }
}

/** Full, standalone, email-client-safe HTML document. */
export function renderNewsletterHtml(opts: RenderOptions): string {
  const blocks = Array.isArray(opts.blocks) ? opts.blocks : [];
  const hasFooter = blocks.some((b) => b?.type === "footer");
  const body = blocks.map((b) => renderBlock(b, opts)).join("");
  const footer = hasFooter
    ? ""
    : renderFooter({ id: "auto-footer", type: "footer" }, opts);
  const preheader = String(opts.preheader ?? "").trim();
  const testBanner = opts.isTest
    ? `<tr><td bgcolor="#FEF3C7" style="padding:10px 32px;background-color:#FEF3C7;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#92400E;">Test send — not delivered to the newsletter audience</td></tr>`
    : "";

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${escapeHtml(opts.subject)}</title>
<style type="text/css">
body { margin:0; padding:0; width:100% !important; }
img { -ms-interpolation-mode:bicubic; }
a { color:${BRAND.green}; }
@media only screen and (max-width:620px) {
  .vt-wrap { width:100% !important; }
  .vt-col { display:block !important; width:100% !important; padding:0 0 18px 0 !important; }
  .vt-pad { padding-left:20px !important; padding-right:20px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.page};">
<div style="display:none;font-size:1px;color:${BRAND.page};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(
    preheader,
  )}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.page}" style="background-color:${BRAND.page};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="vt-wrap" width="${BRAND.maxWidth}" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.white}" style="width:${BRAND.maxWidth}px;max-width:${BRAND.maxWidth}px;background-color:${BRAND.white};border-radius:14px;overflow:hidden;border:1px solid ${BRAND.border};">
${testBanner}
<tr><td bgcolor="${BRAND.greenDark}" style="padding:18px 32px;background-color:${BRAND.greenDark};">
<span style="font-family:${FONT};font-size:19px;font-weight:700;color:#FFFFFF;letter-spacing:0.3px;">VineTrack</span>
</td></tr>
${body}
${footer}
</table>
<p style="margin:16px 0 0 0;font-family:${FONT};font-size:11px;line-height:18px;color:#8A9690;">&copy; ${new Date().getFullYear()} VineTrack</p>
</td></tr>
</table>
</body>
</html>`;
}

/** Plain-text alternative built from the same blocks. */
export function renderNewsletterText(opts: RenderOptions): string {
  const lines: string[] = [];
  if (opts.isTest) lines.push("[TEST SEND]", "");
  lines.push(opts.subject, "");
  for (const block of opts.blocks ?? []) {
    if (!block) continue;
    if (block.type === "divider") {
      lines.push("----------", "");
      continue;
    }
    if (block.eyebrow) lines.push(String(block.eyebrow).toUpperCase());
    if (block.heading) lines.push(String(block.heading));
    if (block.body) lines.push(String(block.body));
    for (const bullet of block.bullets ?? []) lines.push(`- ${bullet}`);
    if (block.ctaLabel && block.ctaUrl) lines.push(`${block.ctaLabel}: ${block.ctaUrl}`);
    for (const card of block.cards ?? []) {
      if (card.heading) lines.push(String(card.heading));
      if (card.body) lines.push(String(card.body));
      if (card.ctaLabel && card.ctaUrl) lines.push(`${card.ctaLabel}: ${card.ctaUrl}`);
    }
    lines.push("");
  }
  lines.push(
    "You are receiving this because you use VineTrack or subscribed to VineTrack updates.",
    "To stop receiving VineTrack newsletters, use the unsubscribe link in this email. Account and billing emails are sent separately.",
  );
  return lines.join("\n");
}
