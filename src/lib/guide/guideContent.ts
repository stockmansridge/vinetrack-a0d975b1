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
import type { GuideImageKey } from "@/lib/guide/guideImages";

/** An uploaded screenshot stored in the existing guide-images bucket. */
export interface GuideStepImage {
  path: string;
  updated_at?: string;
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
  enabled: boolean;
}

export interface GuideContentSection {
  /** Matches GuideArea.id. */
  key: string;
  heading: string;
  intro: string;
  steps: GuideContentStep[];
  enabled: boolean;
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
      enabled: true,
    }));
  }
  return (area.workflow ?? []).map((s, i) => ({
    id: `${area.id}.${i + 1}`,
    heading: s.label,
    body: s.detail ?? "",
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
      updated_at: typeof r.updated_at === "string" ? r.updated_at : undefined,
    };
  }
  return base;
}
