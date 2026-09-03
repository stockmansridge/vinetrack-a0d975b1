// How VineTrack Works — managed guide content (sections + step rows).
//
// IMPORTANT — no Lovable-invented schema.
// Persistence reuses the SAME authoritative System Admin mechanisms already
// used by Guide Images (see guideContentStore.ts):
//   • the system feature-flag configuration store (jsonb value per key), and
//   • the existing `guide-images` storage bucket for screenshots.
// Nothing here creates tables, RPCs or buckets.
//
// This module owns the *shape* of managed content and the built-in defaults
// derived from the existing hard-coded guide data, so the guide renders
// identically until an admin edits something.

import { GUIDE_AREAS, LANDING_GUIDE_AREAS, type GuideArea } from "@/lib/guide/guideAreas";
import { guideWorkflow } from "@/lib/guide/guideWorkflows";
import { coreSetupGroups } from "@/lib/guide/coreSetupGroups";
import {
  operationalToolCatalogueItem,
  operationalToolGuides,
} from "@/lib/guide/operationalToolGuides";
import { REPORT_CATEGORIES } from "@/lib/guide/reportCategories";
import type { GuideImageKey } from "@/lib/guide/guideImages";

/** An uploaded screenshot stored in the existing guide-images bucket. */
export interface GuideStepImage {
  path: string;
  updated_at?: string;
}

export type GuideStepImagePosition = "left" | "right";

/**
 * Legacy layout: rows alternated by index (even rows had the image on the
 * right). Used only to migrate steps saved before imagePosition existed, so
 * the guide keeps its current appearance.
 */
export function legacyImagePosition(index: number): GuideStepImagePosition {
  return index % 2 === 1 ? "left" : "right";
}

export interface GuideContentStep {
  /** Stable row id — never shown to admins, never used as the step number. */
  id: string;
  heading: string;
  body: string;
  /** Free-form availability label, e.g. "iOS / Android". Optional. */
  platform?: string;
  /** Optional supporting chips shown under the step body. */
  items?: string[];
  /** Built-in image slot (Guide Images) used when no upload overrides it. */
  imageKey?: GuideImageKey;
  /** Uploaded screenshot for this row — takes precedence over imageKey. */
  image?: GuideStepImage;
  /**
   * Up to MAX_STEP_IMAGES uploaded screenshots for this row. Takes precedence
   * over `image` (kept for rows saved before multi-image support).
   */
  images?: GuideStepImage[];

  /**
   * Which side the image sits on for desktop/tablet rendering. Explicitly
   * managed per step — never derived from the row number.
   */
  imagePosition?: GuideStepImagePosition;
  enabled: boolean;
}

export interface GuideContentSection {
  /** Matches GuideArea.id. */
  key: string;
  heading: string;
  intro: string;
  steps: GuideContentStep[];
  enabled: boolean;
  /**
   * Existing Guide Images key for this section's highlight/landing image
   * (e.g. "pins"). Reused as-is — never a second identifier.
   */
  imageKey?: GuideImageKey;
  updated_at?: string;
}

export type GuideContentMap = Record<string, GuideContentSection>;

/** Platform label choices offered in the admin editor. */
export const GUIDE_PLATFORM_LABELS = [
  "iOS",
  "Android",
  "Web Portal",
  "iOS / Android",
  "Web / iOS / Android",
] as const;

/**
 * Canonical defaults for the three areas whose drill-down pages render their
 * own structured content (live setup health, the tool catalogue, the reports
 * guide). The copy below is the copy those pages already display — it is
 * imported from the same modules, never re-typed — so admins can see and edit
 * it here. They default to `enabled: false` because these pages do not render
 * a step list today; enabling a row publishes it without any redesign.
 */
function structuredSteps(areaId: string): GuideContentStep[] | undefined {
  if (areaId === "setup") {
    return coreSetupGroups().map((g) => ({
      id: `setup.${g.id}`,
      heading: g.title,
      body: g.summary,
      imagePosition: "left",
      enabled: false,
    }));
  }
  if (areaId === "operational-tools") {
    return operationalToolGuides().map((g) => ({
      id: `operational-tools.${g.toolId}`,
      heading: operationalToolCatalogueItem(g)?.title ?? g.toolId,
      body: g.purpose,
      imageKey: g.imageKey,
      imagePosition: "left",
      enabled: false,
    }));
  }
  if (areaId === "reports") {
    return REPORT_CATEGORIES.map((c) => ({
      id: `reports.${c.itemId}`,
      heading: c.title,
      body: c.body,
      imageKey: c.imageKey,
      imagePosition: "left",
      enabled: false,
    }));
  }
  return undefined;
}

function defaultSteps(area: GuideArea): GuideContentStep[] {
  const workflow = guideWorkflow(area.id);
  if (workflow) {
    return workflow.steps.map((s, i) => ({
      id: `${area.id}.${i + 1}`,
      heading: s.title,
      body: s.body,
      platform: s.where,
      items: s.examples ? [...s.examples] : undefined,
      imageKey: s.imageKey,
      imagePosition: legacyImagePosition(i),
      enabled: true,
    }));
  }
  const structured = structuredSteps(area.id);
  if (structured) return structured;
  return (area.workflow ?? []).map((s, i) => ({
    id: `${area.id}.${i + 1}`,
    heading: s.label,
    body: s.detail ?? "",
    imagePosition: legacyImagePosition(i),
    enabled: true,
  }));
}

/** Built-in content for one area, before any admin overrides. */
export function defaultGuideSection(area: GuideArea): GuideContentSection {
  const workflow = guideWorkflow(area.id);
  return {
    key: area.id,
    heading: area.title,
    intro: workflow?.intro ?? area.detailIntro,
    steps: defaultSteps(area),
    enabled: true,
    /** Landing row + drill-down hero image slot (existing Guide Images key). */
    imageKey: area.id as GuideImageKey,
  };
}

/** Every manageable section, in guide order. */
export function defaultGuideContent(): GuideContentMap {
  const out: GuideContentMap = {};
  for (const area of LANDING_GUIDE_AREAS) out[area.id] = defaultGuideSection(area);
  return out;
}


export function manageableGuideAreas(): GuideArea[] {
  return LANDING_GUIDE_AREAS;
}

export function guideAreaById(key?: string): GuideArea | undefined {
  return GUIDE_AREAS.find((a) => a.id === key);
}

/** Only rows an admin has left enabled are shown to guide readers. */
export function visibleSteps(section: GuideContentSection | undefined): GuideContentStep[] {
  return (section?.steps ?? []).filter((s) => s.enabled);
}

/** New blank row. Ids are unique so repeated clicks can't collide. */
export function newGuideStep(sectionKey: string): GuideContentStep {
  return {
    id: `${sectionKey}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    heading: "",
    body: "",
    imagePosition: "left",
    enabled: true,
  };
}

function sanitiseStep(raw: unknown, index: number, sectionKey: string): GuideContentStep | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const heading = typeof r.heading === "string" ? r.heading : "";
  const body = typeof r.body === "string" ? r.body : "";
  const image =
    r.image && typeof r.image === "object" && typeof (r.image as any).path === "string"
      ? {
          path: (r.image as any).path as string,
          updated_at:
            typeof (r.image as any).updated_at === "string"
              ? ((r.image as any).updated_at as string)
              : undefined,
        }
      : undefined;
  return {
    id: typeof r.id === "string" && r.id ? r.id : `${sectionKey}.${index + 1}`,
    heading,
    body,
    platform: typeof r.platform === "string" && r.platform ? r.platform : undefined,
    items: Array.isArray(r.items)
      ? (r.items.filter((i) => typeof i === "string" && i.trim()) as string[])
      : undefined,
    imageKey: typeof r.imageKey === "string" ? (r.imageKey as GuideImageKey) : undefined,
    image,
    imagePosition:
      r.imagePosition === "left" || r.imagePosition === "right"
        ? r.imagePosition
        : legacyImagePosition(index),
    enabled: r.enabled !== false,
  };
}

/** Parse the stored jsonb value, merged over built-in defaults. */
export function parseGuideContent(value: unknown): GuideContentMap {
  const base = defaultGuideContent();
  if (!value || typeof value !== "object") return base;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const fallback = base[key];
    if (!fallback) continue; // unknown area — ignore, never invent sections
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const steps = Array.isArray(r.steps)
      ? (r.steps
          .map((s, i) => sanitiseStep(s, i, key))
          .filter(Boolean) as GuideContentStep[])
      : fallback.steps;
    base[key] = {
      key,
      heading: typeof r.heading === "string" && r.heading ? r.heading : fallback.heading,
      intro: typeof r.intro === "string" ? r.intro : fallback.intro,
      steps,
      enabled: r.enabled !== false,
      imageKey: fallback.imageKey,
      updated_at: typeof r.updated_at === "string" ? r.updated_at : undefined,
    };
  }
  return base;
}

/**
 * Non-destructive bootstrap of the managed model from the canonical defaults.
 *
 * Rules (deliberately conservative):
 *  • A section already present in `guide.content` is kept exactly as stored —
 *    admin edits are never overwritten, and steps an admin deleted are never
 *    re-added.
 *  • Only missing sections are populated from the canonical defaults.
 *  • Missing section-level fields (heading, intro, highlight image key) are
 *    filled from the defaults so partially written records stay safe.
 */
export function bootstrapGuideContent(raw: unknown): {
  map: GuideContentMap;
  changed: boolean;
} {
  const defaults = defaultGuideContent();
  const stored =
    raw && typeof raw === "object" ? ({ ...(raw as Record<string, unknown>) } as Record<string, unknown>) : {};
  let changed = false;
  const map: GuideContentMap = {};

  for (const [key, fallback] of Object.entries(defaults)) {
    const existing = stored[key];
    if (!existing || typeof existing !== "object") {
      map[key] = { ...fallback, updated_at: new Date().toISOString() };
      changed = true;
      continue;
    }
    const parsed = parseGuideContent({ [key]: existing })[key];
    const filled: GuideContentSection = {
      ...parsed,
      heading: parsed.heading || fallback.heading,
      intro: parsed.intro || fallback.intro,
      imageKey: parsed.imageKey ?? fallback.imageKey,
    };
    if (JSON.stringify(filled) !== JSON.stringify(parsed)) changed = true;
    map[key] = filled;
  }
  return { map, changed };
}
