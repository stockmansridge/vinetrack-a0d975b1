// VineTrack newsletter email renderer — the ONE rendering engine.
//
// Used by:
//   * admin-newsletters  (preview + test send)
//   * admin-newsletter-send (real send, frozen into the version snapshot)
//   * src/test/newsletterRender.test.ts
//
// Deliberately dependency-free, email-client-safe HTML: nested tables, inline
// styles, no flexbox/grid, no CSS variables, no OKLCH, no web fonts. Max width
// 640px. The Portal preview renders exactly this HTML in an iframe, so what the
// admin sees is what is sent.
//
// Colours are the CURRENT vinetrack.com.au website tokens translated to
// email-safe hex (see PALETTE below). Typography is the website stack:
// Inter with Arial/Helvetica fallbacks — never an image of text.

export const BRAND = {
  green: "#2A7140",
  greenDark: "#134323",
  soft: "#F4F8F4",
  softGreen: "#EAF5EC",
  neutral: "#F1F5F1",
  border: "#D6E2D8",
  text: "#1A2C30",
  ink: "#1A2C30",
  muted: "#5B7073",
  white: "#FFFFFF",
  page: "#F1F5F1",
  maxWidth: 640,
} as const;

/** Durable public logo object (guide-images bucket, canonical VineTrack project). */
export const BRAND_LOGO_URL =
  "https://tbafuqwruefgkbyxrxyb.supabase.co/storage/v1/object/public/guide-images/newsletter/branding/vinetrack-logo.png";
export const BRAND_LOGO_PATH = "newsletter/branding/vinetrack-logo.png";
export const BRAND_TAGLINE = "Built by viticulturists, for viticulturists.";

const FONT = "'Inter',Arial,Helvetica,sans-serif";
export const EMAIL_FONT_STACK = FONT;

/** Preset background colours offered in the builder. */
export const BACKGROUND_PRESETS: { value: string; label: string; hex: string }[] = [
  { value: "white", label: "White", hex: BRAND.white },
  { value: "soft", label: "Soft green", hex: BRAND.soft },
  { value: "neutral", label: "Light neutral", hex: BRAND.neutral },
  { value: "green", label: "VineTrack green", hex: BRAND.green },
  { value: "deep", label: "Deep green", hex: BRAND.greenDark },
];

/** Preset text colours offered in the builder. */
export const TEXT_PRESETS: { value: string; label: string; hex: string }[] = [
  { value: "ink", label: "VineTrack ink", hex: BRAND.ink },
  { value: "deep", label: "Deep green", hex: BRAND.greenDark },
  { value: "white", label: "White", hex: BRAND.white },
  { value: "muted", label: "Muted grey", hex: BRAND.muted },
];

export const BUTTON_BG_PRESETS = [
  { value: "green", label: "VineTrack green", hex: BRAND.green },
  { value: "deep", label: "Deep green", hex: BRAND.greenDark },
  { value: "white", label: "White", hex: BRAND.white },
  { value: "ink", label: "VineTrack ink", hex: BRAND.ink },
];

export const BUTTON_TEXT_PRESETS = [
  { value: "white", label: "White", hex: BRAND.white },
  { value: "deep", label: "Deep green", hex: BRAND.greenDark },
  { value: "ink", label: "VineTrack ink", hex: BRAND.ink },
];

export function isHexColour(value: unknown): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value ?? "").trim());
}

function fromPresets(
  presets: { value: string; hex: string }[],
  value: unknown,
  fallback: string,
): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (isHexColour(raw)) return raw.toUpperCase();
  const hit = presets.find((p) => p.value === raw.toLowerCase());
  return hit ? hit.hex : fallback;
}

export function resolveBackground(value: unknown, fallback: string = BRAND.white): string {
  return fromPresets(BACKGROUND_PRESETS, value, fallback);
}
export function resolveTextColour(value: unknown, fallback: string = BRAND.ink): string {
  return fromPresets(TEXT_PRESETS, value, fallback);
}

/** Relative luminance — used for automatic heading colour and contrast checks. */
export function luminance(hex: string): number {
  const raw = String(hex ?? "").replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const parts = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = parts.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

export function isDarkColour(hex: string): boolean {
  return luminance(hex) < 0.4;
}

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
  /** Legacy two-choice background; still honoured. */
  background?: "white" | "soft" | string | null;
  /** Preset key or #hex. */
  bgColor?: string | null;
  textColor?: string | null;
  buttonBgColor?: string | null;
  buttonTextColor?: string | null;
  cards?: NewsletterCard[] | null;
}

export interface RenderOptions {
  subject: string;
  preheader?: string | null;
  blocks: NewsletterBlock[];
  /** Absolute URL used in the footer's site link. */
  siteUrl?: string;
  senderName?: string;
  supportEmail?: string;
  /** Marked in the rendered body so a test is obvious to the admin. */
  isTest?: boolean;
  /** Durable public logo URL; defaults to BRAND_LOGO_URL. */
  logoUrl?: string | null;
  /** Accessible description used by the same logo in the header and footer. */
  logoAlt?: string | null;
}

interface Theme {
  bg: string;
  text: string;
  heading: string;
  eyebrow: string;
  muted: string;
  btnBg: string;
  btnText: string;
  cardBg: string;
  cardBorder: string;
}

function themeFor(block: NewsletterBlock): Theme {
  const legacy = block.background === "soft" ? "soft" : block.background;
  const bg = resolveBackground(block.bgColor ?? legacy, BRAND.white);
  const dark = isDarkColour(bg);
  const text = resolveTextColour(block.textColor, dark ? BRAND.white : BRAND.ink);
  const heading = block.textColor
    ? text
    : dark
    ? BRAND.white
    : BRAND.greenDark;
  return {
    bg,
    text,
    heading,
    eyebrow: dark ? "#BFE3C9" : BRAND.green,
    muted: dark ? "#CFE3D6" : BRAND.muted,
    btnBg: fromPresets(BUTTON_BG_PRESETS, block.buttonBgColor, dark ? BRAND.white : BRAND.green),
    btnText: fromPresets(
      BUTTON_TEXT_PRESETS,
      block.buttonTextColor,
      dark ? BRAND.greenDark : BRAND.white,
    ),
    cardBg: BRAND.white,
    cardBorder: BRAND.border,
  };
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

function paragraphs(
  body: string | null | undefined,
  align: string,
  colour: string,
  size = 16,
): string {
  const text = String(body ?? "").trim();
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p style="margin:0 0 14px 0;font-family:${FONT};font-size:${size}px;line-height:${
          size + 11
        }px;font-weight:400;color:${colour};text-align:${align};">${escapeHtml(para).replace(
          /\n/g,
          "<br />",
        )}</p>`,
    )
    .join("");
}

function bulletList(bullets: string[] | null | undefined, colour: string): string {
  const items = (bullets ?? []).map((b) => String(b ?? "").trim()).filter(Boolean);
  if (items.length === 0) return "";
  const lis = items
    .map(
      (item) =>
        `<li style="margin:0 0 8px 0;font-family:${FONT};font-size:16px;line-height:26px;color:${colour};">${escapeHtml(
          item,
        )}</li>`,
    )
    .join("");
  return `<ul style="margin:0 0 14px 0;padding-left:22px;">${lis}</ul>`;
}

function button(
  label: string | null | undefined,
  url: unknown,
  theme: Theme,
  align = "left",
): string {
  const text = String(label ?? "").trim();
  const href = safeUrl(url);
  if (!text || !href) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="margin:8px 0 2px 0;"><tr><td bgcolor="${theme.btnBg}" style="border-radius:999px;">
<a href="${href}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:${theme.btnText};text-decoration:none;border-radius:999px;">${escapeHtml(
    text,
  )}</a></td></tr></table><div style="clear:both;line-height:0;">&nbsp;</div>`;
}

function image(
  img: NewsletterImage | null | undefined,
  width: number | string = BRAND.maxWidth - 64,
  radius = 12,
): string {
  const url = safeUrl(img?.url);
  if (!url) return "";
  const maxWidth = width === "100%" ? "100%" : `${width}px`;
  return `<img src="${url}" alt="${escapeHtml(
    img?.alt ?? "",
  )}" width="${width}" style="display:block;width:100%;max-width:${maxWidth};height:auto;border:0;outline:none;text-decoration:none;border-radius:${radius}px;" />`;
}

function eyebrow(value: string | null | undefined, align: string, colour: string): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return `<p style="margin:0 0 10px 0;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${colour};text-align:${align};">${escapeHtml(
    text,
  )}</p>`;
}

function heading(
  value: string | null | undefined,
  align: string,
  colour: string,
  size = 28,
  tag: "h1" | "h2" | "h3" = "h2",
): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return `<${tag} style="margin:0 0 14px 0;font-family:${FONT};font-size:${size}px;line-height:${Math.round(
    size * 1.22,
  )}px;font-weight:700;color:${colour};text-align:${align};">${escapeHtml(text)}</${tag}>`;
}

function section(inner: string, theme: Theme, pad = "30px 32px"): string {
  return `<tr><td bgcolor="${theme.bg}" class="vt-pad" style="padding:${pad};background-color:${theme.bg};">${inner}</td></tr>`;
}

function renderHeader(opts: RenderOptions): string {
  const logo = safeUrl(opts.logoUrl ?? BRAND_LOGO_URL);
  const logoAlt = String(opts.logoAlt ?? "VineTrack").trim() || "VineTrack";
  const wordmark = logo
    ? `<img src="${logo}" alt="${escapeHtml(logoAlt)}" width="150" height="38" style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;text-decoration:none;" />`
    : `<span style="font-family:${FONT};font-size:22px;font-weight:700;color:${BRAND.greenDark};letter-spacing:0.2px;">VineTrack</span>`;
  return `<tr><td bgcolor="${BRAND.white}" class="vt-pad" style="padding:22px 32px 18px 32px;background-color:${BRAND.white};border-bottom:1px solid ${BRAND.border};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="vt-col" valign="middle" width="45%" align="left" style="padding:0;">${wordmark}</td>
<td class="vt-col vt-right" valign="middle" width="55%" align="right" style="padding:0;">
<span style="font-family:${FONT};font-size:13px;line-height:20px;font-weight:500;color:${BRAND.muted};">${escapeHtml(
    BRAND_TAGLINE,
  )}</span></td>
</tr></table></td></tr>`;
}

function renderHero(block: NewsletterBlock): string {
  const theme = themeFor(block);
  const align = block.align === "center" ? "center" : "left";
  const text = [
    eyebrow(block.eyebrow, align, theme.eyebrow),
    heading(block.heading, align, theme.heading, 40, "h1"),
    paragraphs(block.body, align, theme.text, 17),
    button(block.ctaLabel, block.ctaUrl, theme, align),
  ].join("");
  const heroImage = image(block.image, "100%", 0);
  return heroImage
    ? `<tr><td bgcolor="${theme.bg}" style="padding:0;background-color:${theme.bg};">${heroImage}</td></tr>${section(text, theme, "28px 32px 34px 32px")}`
    : section(text, theme, "32px 32px 34px 32px");
}

function renderFeature(block: NewsletterBlock): string {
  const theme = themeFor(block);
  const align = "left";
  const textCol = [
    eyebrow(block.eyebrow, align, theme.eyebrow),
    heading(block.heading, align, theme.heading, 26),
    paragraphs(block.body, align, theme.text),
    bulletList(block.bullets, theme.text),
    button(block.ctaLabel, block.ctaUrl, theme, align),
  ].join("");
  const imgCol = image(block.image, "100%", 10);
  if (!imgCol) return section(textCol, theme);
  const imageLeft = block.layout !== "image-right";
  const direction = imageLeft ? "ltr" : "rtl";
  const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${direction}"><tr>
<td class="vt-col vt-feature-image" width="45%" valign="top" dir="ltr" style="padding:0 14px 0 0;">${imgCol}</td>
<td class="vt-col" width="55%" valign="top" dir="ltr" style="padding:0 0 0 14px;">${textCol}</td>
</tr></table>`;
  return section(inner, theme);
}

function renderText(block: NewsletterBlock): string {
  const theme = themeFor(block);
  const align = block.align === "center" ? "center" : "left";
  const inner = [
    eyebrow(block.eyebrow, align, theme.eyebrow),
    heading(block.heading, align, theme.heading, 26),
    paragraphs(block.body, align, theme.text),
    bulletList(block.bullets, theme.text),
    button(block.ctaLabel, block.ctaUrl, theme, align),
  ].join("");
  return section(inner, theme);
}

function renderCards(block: NewsletterBlock): string {
  const theme = themeFor(block);
  const cards = (block.cards ?? []).slice(0, 3);
  if (cards.length === 0) return "";
  const cells = cards
    .map((card) => {
      const content = [
        heading(card.heading, "left", BRAND.greenDark, 18, "h3"),
        paragraphs(card.body, "left", BRAND.ink, 15),
        button(card.ctaLabel, card.ctaUrl, { ...theme, btnBg: BRAND.green, btnText: BRAND.white }, "left"),
      ].join("");
      const cardImage = image(card.image, "100%", 0);
      return `<td class="vt-col" valign="top" width="33.33%" style="padding:6px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${theme.cardBg}" style="background-color:${theme.cardBg};border:1px solid ${theme.cardBorder};border-radius:14px;">
${cardImage ? `<tr><td style="padding:0;overflow:hidden;border-radius:13px 13px 0 0;">${cardImage}</td></tr>` : ""}
<tr><td style="padding:18px;">${content}</td></tr></table></td>`;
    })
    .join("");
  const inner = [
    eyebrow(block.eyebrow, "left", theme.eyebrow),
    heading(block.heading, "left", theme.heading, 26),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`,
  ].join("");
  return section(inner, theme);
}

function renderButton(block: NewsletterBlock): string {
  const theme = themeFor(block);
  const align = block.align === "center" ? "center" : "left";
  const inner = button(block.ctaLabel, block.ctaUrl, theme, align);
  if (!inner) return "";
  return section(inner, theme, "18px 32px");
}

function renderDivider(): string {
  return `<tr><td bgcolor="${BRAND.white}" style="padding:4px 32px;background-color:${BRAND.white};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" bgcolor="${BRAND.border}" style="height:1px;line-height:1px;font-size:0;">&nbsp;</td></tr></table></td></tr>`;
}

/**
 * Branded footer. The unsubscribe MECHANISM is unchanged: VineTrack's email
 * service adds the provider unsubscribe link/header to every marketing send and
 * enforces suppression. Nothing here depends on an image loading.
 */
function renderFooter(block: NewsletterBlock, opts: RenderOptions): string {
  const site = safeUrl(opts.siteUrl ?? "https://www.vinetrack.com.au");
  const support = escapeHtml(opts.supportEmail ?? "support@vinetrack.com.au");
  const extra = String(block.body ?? "").trim();
  const logo = safeUrl(opts.logoUrl ?? BRAND_LOGO_URL);
  const logoAlt = String(opts.logoAlt ?? "VineTrack").trim() || "VineTrack";
  const link = (label: string, href: string | null) =>
    href
      ? `<a href="${href}" style="color:${BRAND.greenDark};text-decoration:underline;font-weight:600;">${label}</a>`
      : `<span style="color:${BRAND.muted};">${label}</span>`;

  return `<tr><td bgcolor="${BRAND.softGreen}" height="6" style="height:6px;line-height:6px;font-size:0;background-color:${BRAND.softGreen};">&nbsp;</td></tr>
<tr><td bgcolor="${BRAND.soft}" class="vt-pad" style="padding:28px 32px 18px 32px;background-color:${BRAND.soft};border-top:1px solid ${BRAND.border};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="vt-col" width="55%" valign="top" style="padding:0;">
<p style="margin:0 0 6px 0;font-family:${FONT};font-size:15px;line-height:24px;font-weight:700;color:${BRAND.greenDark};">Thanks for being part of VineTrack.</p>
<p style="margin:0;font-family:${FONT};font-size:14px;line-height:22px;color:${BRAND.ink};">Jonathan<br /><span style="color:${BRAND.muted};">VineTrack</span></p>
${
    extra
      ? `<p style="margin:10px 0 0 0;font-family:${FONT};font-size:13px;line-height:21px;color:${BRAND.muted};">${escapeHtml(
          extra,
        )}</p>`
      : ""
  }
</td>
<td class="vt-col vt-right" width="45%" valign="top" align="right" style="padding:0;">
${
    logo
      ? `<img src="${logo}" alt="${escapeHtml(logoAlt)}" width="128" height="32" style="display:inline-block;width:128px;max-width:128px;height:auto;border:0;outline:none;text-decoration:none;" />`
      : `<span style="font-family:${FONT};font-size:17px;font-weight:700;color:${BRAND.greenDark};">VineTrack</span>`
  }
<p style="margin:8px 0 0 0;font-family:${FONT};font-size:12px;line-height:19px;color:${BRAND.muted};">${escapeHtml(
    BRAND_TAGLINE,
  )}</p>
</td></tr></table>
</td></tr>
<tr><td bgcolor="${BRAND.soft}" class="vt-pad" style="padding:0 32px 26px 32px;background-color:${BRAND.soft};">
<p style="margin:0 0 8px 0;font-family:${FONT};font-size:13px;line-height:22px;color:${BRAND.muted};">
${link("Website", site)} &nbsp;|&nbsp; ${link("Support", `mailto:${support}`)} &nbsp;|&nbsp; <span style="color:${BRAND.muted};">Unsubscribe</span>
</p>
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
  const footer = hasFooter ? "" : renderFooter({ id: "auto-footer", type: "footer" }, opts);
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
h1,h2,h3 { font-family:${FONT}; }
@media only screen and (max-width:620px) {
  .vt-wrap { width:100% !important; }
  .vt-col { display:block !important; width:100% !important; padding:0 0 18px 0 !important; }
  .vt-right { text-align:left !important; }
  .vt-pad { padding-left:20px !important; padding-right:20px !important; }
  .vt-feature-image { display:table-header-group !important; width:100% !important; }
  h1 { font-size:32px !important; line-height:38px !important; }
  h2 { font-size:23px !important; line-height:30px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.page};">
<div style="display:none;font-size:1px;color:${BRAND.page};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(
    preheader,
  )}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.page}" style="background-color:${BRAND.page};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="vt-wrap" width="${BRAND.maxWidth}" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.white}" style="width:${BRAND.maxWidth}px;max-width:${BRAND.maxWidth}px;background-color:${BRAND.white};border-radius:16px;overflow:hidden;border:1px solid ${BRAND.border};">
${testBanner}
${renderHeader(opts)}
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
  lines.push(`VineTrack — ${BRAND_TAGLINE}`, "");
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
    "Thanks for being part of VineTrack. — Jonathan, VineTrack",
    "You are receiving this because you use VineTrack or subscribed to VineTrack updates.",
    "To stop receiving VineTrack newsletters, use the unsubscribe link in this email. Account and billing emails are sent separately.",
  );
  return lines.join("\n");
}
