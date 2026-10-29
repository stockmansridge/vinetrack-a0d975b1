// Research hints for an existing Chemical V3 discovery job (System Admin only).
// Hints only guide a new AI search through chemical_v3_set_research_hints; they never
// change a revision's verified identity or any approved catalogue row.
import { supabase } from "@/integrations/ios-supabase/client";

type Row = Record<string, any>;
const sb = supabase as any;

export const V3_SET_HINTS_RPC = "chemical_v3_set_research_hints";
export const HINT_LIMITS = { name: 180, notes: 1200, url: 2048 } as const;
export const HINTS_EXPLAINER =
  "These details guide a new AI search. VineTrack verifies the registration and formulation before applying results. Research notes do not change the chemical's approved identity.";
export const HINT_BUSY_STATUSES = ["queued", "running", "processing", "in_progress", "started"];

export interface ResearchHintsDraft { productName: string; productUrl: string; labelUrl: string; notes: string }
export const EMPTY_HINTS: ResearchHintsDraft = { productName: "", productUrl: "", labelUrl: "", notes: "" };

const str = (v: unknown) => (typeof v === "string" ? v : "");
export function readResearchHints(job: Row | null | undefined): ResearchHintsDraft {
  const h = job?.research_hints && typeof job.research_hints === "object" ? job.research_hints : {};
  return {
    productName: str(h.product_name),
    productUrl: str(h.manufacturer_product_url),
    labelUrl: str(h.manufacturer_label_url),
    notes: str(h.research_notes),
  };
}
export const hasResearchHints = (job: Row | null | undefined) =>
  Object.values(readResearchHints(job)).some((v) => v.trim().length > 0);
export const isJobBusy = (status: unknown) => HINT_BUSY_STATUSES.includes(String(status ?? "").toLowerCase());

function urlError(label: string, v: string): string | null {
  if (!v) return null;
  if (v.length > HINT_LIMITS.url) return `${label} must be ${HINT_LIMITS.url} characters or fewer.`;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return `${label} must start with https://.`;
  } catch { return `${label} must be a full https:// link.`; }
  return null;
}
export function validateResearchHints(d: ResearchHintsDraft): Partial<Record<keyof ResearchHintsDraft, string>> {
  const e: Partial<Record<keyof ResearchHintsDraft, string>> = {};
  if (d.productName.trim().length > HINT_LIMITS.name) e.productName = `Search name must be ${HINT_LIMITS.name} characters or fewer.`;
  if (d.notes.trim().length > HINT_LIMITS.notes) e.notes = `Research instructions must be ${HINT_LIMITS.notes} characters or fewer.`;
  const pu = urlError("Manufacturer product page", d.productUrl.trim()); if (pu) e.productUrl = pu;
  const lu = urlError("Manufacturer label link", d.labelUrl.trim()); if (lu) e.labelUrl = lu;
  return e;
}
const orNull = (v: string) => (v.trim() ? v.trim() : null);
export function buildResearchHintsArgs(jobId: string, d: ResearchHintsDraft) {
  return {
    p_job_id: jobId,
    p_product_name: orNull(d.productName),
    p_manufacturer_product_url: orNull(d.productUrl),
    p_manufacturer_label_url: orNull(d.labelUrl),
    p_research_notes: orNull(d.notes),
  };
}
export async function saveResearchHints(jobId: string, d: ResearchHintsDraft): Promise<{ research_hints: Row | null; changed: boolean }> {
  const { data, error } = await sb.rpc(V3_SET_HINTS_RPC, buildResearchHintsArgs(jobId, d));
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) ?? {};
  return { research_hints: row.research_hints ?? null, changed: Boolean(row.changed) };
}

// ---- Identity safety -------------------------------------------------------

/** Known distinct AU registrations that must never be matched on shared actives / similar names. */
export const KNOWN_DISTINCT_REGISTRATIONS: Record<string, string> = {
  "53673": "Spotlight Herbicide (240 g/L carfentrazone-ethyl)",
  "61716": "Spotlight Plus Herbicide (60 g/L carfentrazone-ethyl)",
  "63228": "Hammer 400 EC",
};
const KNOWN_NAME_REG: [RegExp, string][] = [
  [/spotlight[\s_-]*plus/i, "61716"],
  [/hammer/i, "63228"],
  [/spotlight(?![\s_-]*plus)/i, "53673"],
];
export const normReg = (v: unknown) => {
  const s = String(v ?? "").replace(/[^0-9a-z]/gi, "").toUpperCase();
  return s || null;
};
/** Registration implied by a known product name / URL slug, if any. */
export function knownRegistrationFor(text: unknown): string | null {
  const s = String(text ?? "");
  if (!s) return null;
  for (const [re, reg] of KNOWN_NAME_REG) if (re.test(s)) return reg;
  return null;
}
const DISTINCT_TOKENS = ["plus", "max", "ultra", "pro", "xl", "duo", "extra", "forte", "advance", "elite"];
const tokens = (s: string) => new Set(s.toLowerCase().replace(/https?:\/\/[^/]+/, " ").split(/[^a-z0-9]+/).filter(Boolean));

/** Warning when supplied hints point at what looks like a distinct registration/formulation. */
export function hintIdentityWarning(revision: Row | null | undefined, d: ResearchHintsDraft): string | null {
  const name = String(revision?.product_name ?? "");
  const reg = normReg(revision?.registration_number);
  const nameTokens = tokens(name);
  for (const src of [d.productName, d.productUrl, d.labelUrl]) {
    if (!src.trim()) continue;
    const implied = knownRegistrationFor(src);
    if (implied && reg && implied !== reg) {
      return `This source appears to describe ${KNOWN_DISTINCT_REGISTRATIONS[implied]} (registration ${implied}), not registration ${reg}. It may be a different registered product or formulation.`;
    }
    const extra = [...tokens(src)].filter((t) => DISTINCT_TOKENS.includes(t) && !nameTokens.has(t));
    if (extra.length) {
      return `This source mentions "${extra.join(", ")}", which is not in "${name || "the discovered product"}". It may be a different registered product or formulation.`;
    }
  }
  return null;
}

/** Catalogue-match registration check. "mismatch" disables the match action. */
export function catalogueRegistrationCheck(
  revision: { registration?: unknown; name?: unknown },
  catalogue: { registration?: unknown; name?: unknown },
): "same" | "mismatch" | "unknown" {
  const a = normReg(revision.registration) ?? knownRegistrationFor(revision.name);
  const b = normReg(catalogue.registration) ?? knownRegistrationFor(catalogue.name);
  if (!a || !b) return "unknown";
  return a === b ? "same" : "mismatch";
}
