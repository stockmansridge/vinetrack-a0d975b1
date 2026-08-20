// How VineTrack Works — guide image slot definitions (Stage 2.9).
//
// These are STABLE KEYS, never display titles. One key feeds both the landing
// row image and that area's drill-down hero, so a System Admin uploads once.

export type GuideImageKey =
  | "hero"
  | "setup"
  | "pins"
  | "trips"
  | "sprays"
  | "work-tasks"
  | "operational-tools"
  | "reports";

export type GuideImageFocus = "left" | "center" | "right";

export interface GuideImageSlot {
  key: GuideImageKey;
  label: string;
  usage: string;
  guidance: string;
  minWidth: number;
  defaultFocus: GuideImageFocus;
}

export const GUIDE_IMAGE_SLOTS: GuideImageSlot[] = [
  {
    key: "hero",
    label: "Hero",
    usage: "How VineTrack Works landing hero banner",
    guidance:
      "Wide landscape image — vineyard, tractor, devices — with the interesting content biased to the right (the left side sits under the text fade).",
    minWidth: 1600,
    defaultFocus: "right",
  },
  {
    key: "setup",
    label: "Getting Started — Setup",
    usage: "Landing row + Setup guide hero",
    guidance: "Landscape image with useful content across the frame.",
    minWidth: 1000,
    defaultFocus: "center",
  },
  {
    key: "pins",
    label: "Pins, Repairs & Observations",
    usage: "Landing row + Pins guide hero",
    guidance: "Landscape image with useful content across the frame.",
    minWidth: 1000,
    defaultFocus: "center",
  },
  {
    key: "trips",
    label: "Field Trips",
    usage: "Landing row + Trips guide hero",
    guidance: "Landscape image with useful content across the frame.",
    minWidth: 1000,
    defaultFocus: "center",
  },
  {
    key: "sprays",
    label: "Spray Planning & Sprays",
    usage: "Landing row + Sprays guide hero",
    guidance: "Landscape image with useful content across the frame.",
    minWidth: 1000,
    defaultFocus: "center",
  },
  {
    key: "work-tasks",
    label: "Work Tasks",
    usage: "Landing row + Work Tasks guide hero",
    guidance: "Landscape image with useful content across the frame.",
    minWidth: 1000,
    defaultFocus: "center",
  },
  {
    key: "operational-tools",
    label: "Operational Tools",
    usage: "Landing row + Operational Tools guide hero",
    guidance: "Landscape image with useful content across the frame.",
    minWidth: 1000,
    defaultFocus: "center",
  },
  {
    key: "reports",
    label: "Reports & Insights",
    usage: "Landing row + Reports guide hero",
    guidance: "Landscape image with useful content across the frame.",
    minWidth: 1000,
    defaultFocus: "center",
  },
];

export function guideImageSlot(key: string): GuideImageSlot | undefined {
  return GUIDE_IMAGE_SLOTS.find((s) => s.key === key);
}

/** CSS object-position value for a focus setting. */
export function focusToObjectPosition(focus: GuideImageFocus | undefined): string {
  switch (focus) {
    case "left":
      return "left center";
    case "right":
      return "right center";
    default:
      return "center center";
  }
}

export const GUIDE_IMAGE_ACCEPT = ["image/jpeg", "image/png", "image/webp"];
export const GUIDE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Returns a friendly error string, or null when the file is acceptable. */
export function validateGuideImageFile(file: File): string | null {
  const type = (file.type || "").toLowerCase();
  if (!GUIDE_IMAGE_ACCEPT.includes(type)) {
    return "Unsupported file type. Please upload a JPEG, PNG or WebP image.";
  }
  if (file.size > GUIDE_IMAGE_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `That image is ${mb} MB. Please upload an image of 10 MB or less.`;
  }
  return null;
}
