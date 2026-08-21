// Master Catalogue Review — R2-C readability layer.
//
// Turns the DISPLAY-ONLY preview payload into a human-readable diff. Nothing
// here writes, and nothing here changes what the portal sends to the backend:
// Apply still posts only { preview_id, master_id, reason }.

import { withholdingDisplay } from "@/lib/chemicalLabelRates";
import type { MasterPreviewChange } from "@/lib/masterReviewPreview";

export type ChangeType = "added" | "removed" | "changed" | "unchanged";

const blank = (v: string | null | undefined) => v == null || v.trim() === "" || v === "—";

export function changeType(
  current: string | null | undefined,
  proposed: string | null | undefined,
): ChangeType {
  if (blank(current) && blank(proposed)) return "unchanged";
  if (blank(current)) return "added";
  if (blank(proposed)) return "removed";
  return current!.trim() === proposed!.trim() ? "unchanged" : "changed";
}

export const CHANGE_TYPE_LABEL: Record<ChangeType, string> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  unchanged: "Unchanged",
};

/** Registered-uses fields are rendered as structured cards, never as JSON. */
export const isRegisteredUsesField = (field: string): boolean =>
  /registered_?uses|label_?uses/i.test(field);

/* --------------------------------------------------------- value coercion */

const obj = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};

const str = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
};

/** Accepts an array, a JSON string of an array, or a single use object. */
export function coerceUseList(value: unknown): Record<string, any>[] {
  let v = value;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s.startsWith("[") && !s.startsWith("{")) return [];
    try {
      v = JSON.parse(s);
    } catch {
      return [];
    }
  }
  if (Array.isArray(v)) return v.filter((e) => e && typeof e === "object") as Record<string, any>[];
  if (v && typeof v === "object") return [v as Record<string, any>];
  return [];
}

/* ------------------------------------------------------------- use views */

export interface UseRateView {
  text: string;
  basis: string;
  referenceOnly: boolean;
}

export interface UseView {
  /** Stable identity for pairing current vs proposed uses. */
  key: string;
  crop: string;
  target: string;
  rates: UseRateView[];
  ratesText: string;
  rateBasisText: string;
  whp: string;
  restrictions: string;
  source: string;
}

const BASIS_LABEL: Record<string, string> = {
  per_100_litres: "Per 100 L",
  range_per_100_litres: "Per 100 L (range)",
  per_hectare: "Per hectare",
  range_per_hectare: "Per hectare (range)",
  other: "Reference only",
};

const nfmt = (n: unknown): string => {
  const x = Number(n);
  return Number.isFinite(x) ? String(x) : "";
};

function rateView(raw: unknown): UseRateView {
  const r = obj(raw);
  const basis = str(r.basis) ?? "other";
  const unit = (str(r.unit) ?? "").replace(/\/(100\s*l|ha)$/i, "").trim();
  const suffix = /100_litres/.test(basis) ? "/100 L" : /hectare/.test(basis) ? "/ha" : "";
  const referenceOnly = basis === "other" || !unit;
  const label = str(r.label);

  let text: string;
  if (referenceOnly) {
    text = str(r.raw_text) ?? label ?? "Rate stated on label";
  } else if (/^range_/.test(basis)) {
    const lo = nfmt(r.min_value);
    const hi = nfmt(r.max_value);
    text = lo && hi && lo !== hi ? `${lo}–${hi} ${unit}${suffix}` : `${lo || hi} ${unit}${suffix}`;
  } else {
    text = `${nfmt(r.value)} ${unit}${suffix}`.trim();
  }
  return {
    text: label && !referenceOnly ? `${text} (${label})` : text,
    basis: BASIS_LABEL[basis] ?? basis,
    referenceOnly,
  };
}

export function toUseView(raw: unknown): UseView {
  const u = obj(raw);
  const crop = str(u.crop) ?? str(u.crop_raw) ?? "Unspecified crop";
  const target = str(u.target) ?? str(u.target_raw) ?? "Unspecified target";
  const rates = (Array.isArray(u.rates) ? u.rates : []).map(rateView);
  const restrictionsRaw = str(u.restrictions) ?? str(u.restraints) ?? "";
  const whpDays = u.withholding_period_days ?? u.whp_days ?? u.withholding_period;
  const whp =
    typeof whpDays === "number"
      ? (withholdingDisplay(whpDays, restrictionsRaw) ?? String(whpDays))
      : (str(whpDays) ?? "Not resolved");
  const prov = obj(u.provenance);
  const source =
    str(prov.rates) ?? str(prov.claim) ?? str(u.claim) ?? str(u.source) ?? "APVMA resolver";

  return {
    key: `${crop.toLowerCase()}||${target.toLowerCase()}`,
    crop,
    target,
    rates,
    ratesText: rates.length ? rates.map((r) => r.text).join(" · ") : "No rate resolved",
    rateBasisText: rates.length
      ? Array.from(new Set(rates.map((r) => r.basis))).join(" · ")
      : "—",
    whp,
    restrictions: restrictionsRaw || "None stated",
    source: source.replace(/_/g, " "),
  };
}

export const parseRegisteredUses = (value: unknown): UseView[] =>
  coerceUseList(value).map(toUseView);

/* ---------------------------------------------------------- use diffing */

export type UseDiffStatus = "added" | "removed" | "changed" | "unchanged";

export interface UseDiffRow {
  key: string;
  status: UseDiffStatus;
  current: UseView | null;
  proposed: UseView | null;
  /** Which of crop/target/rates/whp/restrictions differ. */
  changedFields: string[];
}

const COMPARED: (keyof UseView)[] = ["ratesText", "rateBasisText", "whp", "restrictions"];
const FIELD_LABEL: Partial<Record<keyof UseView, string>> = {
  ratesText: "Rate",
  rateBasisText: "Rate basis",
  whp: "WHP",
  restrictions: "Restrictions",
};

export function diffRegisteredUses(currentRaw: unknown, proposedRaw: unknown): UseDiffRow[] {
  const current = parseRegisteredUses(currentRaw);
  const proposed = parseRegisteredUses(proposedRaw);
  const byKey = (list: UseView[]) => {
    const m = new Map<string, UseView>();
    list.forEach((u, i) => m.set(m.has(u.key) ? `${u.key}#${i}` : u.key, u));
    return m;
  };
  const cur = byKey(current);
  const pro = byKey(proposed);
  const keys = Array.from(new Set([...cur.keys(), ...pro.keys()]));

  return keys.map((key) => {
    const c = cur.get(key) ?? null;
    const p = pro.get(key) ?? null;
    if (!c) return { key, status: "added" as const, current: null, proposed: p, changedFields: [] };
    if (!p) return { key, status: "removed" as const, current: c, proposed: null, changedFields: [] };
    const changedFields = COMPARED.filter((f) => c[f] !== p[f]).map(
      (f) => FIELD_LABEL[f] ?? String(f),
    );
    return {
      key,
      status: changedFields.length ? ("changed" as const) : ("unchanged" as const),
      current: c,
      proposed: p,
      changedFields,
    };
  });
}

export interface UseDiffGroups {
  added: UseDiffRow[];
  changed: UseDiffRow[];
  removed: UseDiffRow[];
  unchanged: UseDiffRow[];
  total: number;
}

export function groupUseDiff(rows: UseDiffRow[]): UseDiffGroups {
  return {
    added: rows.filter((r) => r.status === "added"),
    changed: rows.filter((r) => r.status === "changed"),
    removed: rows.filter((r) => r.status === "removed"),
    unchanged: rows.filter((r) => r.status === "unchanged"),
    total: rows.length,
  };
}

/** Best-effort source attribution for a scalar field change. */
export function changeSource(change: MasterPreviewChange): string {
  const src = (change as any).source as string | null | undefined;
  if (src && src.trim()) return src.replace(/_/g, " ");
  return "APVMA resolver";
}

/** Highlight uses mentioning grapes (the reviewer's primary interest). */
export const isGrapeUse = (u: UseView | null): boolean =>
  !!u && /grape|vine|vitis/i.test(`${u.crop} ${u.target}`);
