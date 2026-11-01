/**
 * Valve-to-block irrigated area helpers. The UI edits hectares as raw text;
 * the shared RPC stores square metres in serviced_area_m2 (1 ha = 10 000 m²).
 * Missing is never zero and block polygon area is never substituted.
 */
export const M2_PER_HA = 10000;

/** Display text (hectares) for a saved m² value; blank when missing/invalid. */
export function haTextFromM2(m2: number | null | undefined): string {
  if (m2 == null || !Number.isFinite(m2) || m2 <= 0) return "";
  // Round to avoid float artefacts (e.g. 0.30000000000000004) without losing m² precision.
  return String(Number((m2 / M2_PER_HA).toFixed(6)));
}

/** Allows partial decimal typing such as "", "0", "0.", ".5", "1.25". */
export function isAreaTypingAllowed(text: string): boolean {
  return /^\d*\.?\d*$/.test(text);
}

export type AreaParse =
  | { kind: "blank" }
  | { kind: "invalid" }
  | { kind: "valid"; ha: number; m2: number };

export function parseAreaHa(text: string): AreaParse {
  const t = text.trim();
  if (t === "") return { kind: "blank" };
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return { kind: "invalid" };
  const ha = Number(t);
  if (!Number.isFinite(ha) || ha <= 0) return { kind: "invalid" };
  return { kind: "valid", ha, m2: ha * M2_PER_HA };
}

/** Inline validation message for one selected block, or null when OK. */
export function areaError(text: string, method: string): string | null {
  const p = parseAreaHa(text);
  if (p.kind === "invalid") return "Enter an area greater than 0 ha.";
  if (p.kind === "blank" && method === "irrigated_area")
    return "Irrigated area is required for this method.";
  return null;
}

/** m² to submit for a block: parsed value, or null when blank. Throws if invalid. */
export function servicedAreaM2ForSave(text: string): number | null {
  const p = parseAreaHa(text);
  if (p.kind === "invalid") throw new Error("Invalid irrigated area");
  return p.kind === "valid" ? p.m2 : null;
}
