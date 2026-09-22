// VineTrack newsletter palette + typography (Portal editor side).
//
// These values MIRROR supabase/functions/_shared/newsletter/render.ts, which is
// the single renderer used for preview, test sends and real sends. The mirror
// exists so the Portal editor never imports Deno function code; a test asserts
// the two lists stay identical (src/test/newsletterBrand.test.ts).
//
// Source of truth: the current vinetrack.com.au design tokens, converted from
// OKLCH to email-safe hex. Delivered email never contains CSS variables.

export const NEWSLETTER_EMAIL_FONT = "'Inter',Arial,Helvetica,sans-serif";

export const NEWSLETTER_BRAND = {
  green: "#2A7140",
  greenDark: "#134323",
  soft: "#F4F8F4",
  softGreen: "#EAF5EC",
  neutral: "#F1F5F1",
  border: "#D6E2D8",
  ink: "#1A2C30",
  muted: "#5B7073",
  white: "#FFFFFF",
} as const;

export interface ColourOption {
  value: string;
  label: string;
  hex: string;
}

export const BACKGROUND_OPTIONS: ColourOption[] = [
  { value: "white", label: "White", hex: NEWSLETTER_BRAND.white },
  { value: "soft", label: "Soft green", hex: NEWSLETTER_BRAND.soft },
  { value: "neutral", label: "Light neutral", hex: NEWSLETTER_BRAND.neutral },
  { value: "green", label: "VineTrack green", hex: NEWSLETTER_BRAND.green },
  { value: "deep", label: "Deep green", hex: NEWSLETTER_BRAND.greenDark },
];

export const TEXT_OPTIONS: ColourOption[] = [
  { value: "ink", label: "VineTrack ink", hex: NEWSLETTER_BRAND.ink },
  { value: "deep", label: "Deep green", hex: NEWSLETTER_BRAND.greenDark },
  { value: "white", label: "White", hex: NEWSLETTER_BRAND.white },
  { value: "muted", label: "Muted grey", hex: NEWSLETTER_BRAND.muted },
];

export const BUTTON_BACKGROUND_OPTIONS: ColourOption[] = [
  { value: "green", label: "VineTrack green", hex: NEWSLETTER_BRAND.green },
  { value: "deep", label: "Deep green", hex: NEWSLETTER_BRAND.greenDark },
  { value: "white", label: "White", hex: NEWSLETTER_BRAND.white },
  { value: "ink", label: "VineTrack ink", hex: NEWSLETTER_BRAND.ink },
];

export const BUTTON_TEXT_OPTIONS: ColourOption[] = [
  { value: "white", label: "White", hex: NEWSLETTER_BRAND.white },
  { value: "deep", label: "Deep green", hex: NEWSLETTER_BRAND.greenDark },
  { value: "ink", label: "VineTrack ink", hex: NEWSLETTER_BRAND.ink },
];

export function isValidHexColour(value: string | null | undefined): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value ?? "").trim());
}

/** Preset key or #hex -> hex. Unknown values fall back. */
export function colourHex(
  options: ColourOption[],
  value: string | null | undefined,
  fallback: string,
): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (isValidHexColour(raw)) return raw.toUpperCase();
  return options.find((o) => o.value === raw.toLowerCase())?.hex ?? fallback;
}

function channelLuminance(hex: string): number {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const parts = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = parts.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrast(a: string, b: string): number {
  const la = channelLuminance(a);
  const lb = channelLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Warning text when a text/background pair would be hard to read (never auto-changed). */
export function contrastWarning(bgHex: string, textHex: string): string | null {
  const ratio = contrast(bgHex, textHex);
  if (ratio >= 4.5) return null;
  return ratio < 2.5
    ? "This text will be very hard to read on that background."
    : "This text may be hard to read on that background.";
}
