// Shared helpers for chemical "Product label / SDS / source link" handling.
//
// Mirrors the iOS `saved_chemicals.label_url` field. Accepts only http(s) URLs,
// trims whitespace, and returns a friendly validation message when invalid.

export function normaliseLabelUrl(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export interface LabelUrlValidation {
  ok: boolean;
  value: string; // trimmed value (empty string when blank)
  error?: string;
}

export function validateLabelUrl(value: string | null | undefined): LabelUrlValidation {
  const trimmed = normaliseLabelUrl(value);
  if (!trimmed) return { ok: true, value: "" };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, value: trimmed, error: "Enter a full link starting with https:// or http://" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, value: trimmed, error: "Only http:// or https:// links are allowed" };
  }
  return { ok: true, value: parsed.toString() };
}

/** Best-effort sanitise for storage: returns trimmed http(s) URL, or null. */
export function sanitiseLabelUrlForSave(value: string | null | undefined): string | null {
  const res = validateLabelUrl(value);
  if (!res.ok || !res.value) return null;
  return res.value;
}
