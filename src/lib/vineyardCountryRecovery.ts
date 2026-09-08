// Recovery path for the "vineyard country not set" block on chemical lookup.
//
// The jurisdiction guard itself is unchanged: the selected vineyard's country
// is the ONLY authority and lookup stays blocked until it is saved. This
// module only carries the operator to the right settings field and back,
// preserving whatever they had typed.

export const VINEYARD_COUNTRY_PROMPT =
  "Set this vineyard\u2019s country to search the correct national chemical register.";

export const SET_VINEYARD_COUNTRY_LABEL = "Set vineyard country";

export const ASK_OWNER_MANAGER_MESSAGE =
  "Ask a vineyard Owner or Manager to set the country.";

/** Vineyard PROFILE country field — not Region & Units. */
export const VINEYARD_COUNTRY_SETTINGS_PATH = "/setup/vineyard";
export const VINEYARD_COUNTRY_FIELD_ID = "vcountry";
export const VINEYARD_COUNTRY_SETTINGS_TARGET = `${VINEYARD_COUNTRY_SETTINGS_PATH}#${VINEYARD_COUNTRY_FIELD_ID}`;

/** Only Owners and Managers can edit vineyard settings. */
export function canEditVineyardCountry(role: string | null | undefined): boolean {
  return role === "owner" || role === "manager";
}

export interface CountryReturnContext {
  /** Path (with query) of the chemical screen to return to. */
  path: string;
  /** Human label for the return action, e.g. "Chemical Store". */
  label: string;
  /** Opaque host state (search text, unsaved editor draft, spray context). */
  state?: Record<string, unknown>;
}

const KEY = "vt_chemical_country_return";

function store(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function saveCountryReturnContext(ctx: CountryReturnContext): void {
  try {
    store()?.setItem(KEY, JSON.stringify(ctx));
  } catch {
    /* preserving context is best-effort; never block the recovery action */
  }
}

export function readCountryReturnContext(): CountryReturnContext | null {
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CountryReturnContext;
    if (!parsed || typeof parsed.path !== "string") return null;
    return { path: parsed.path, label: parsed.label ?? "chemicals", state: parsed.state };
  } catch {
    return null;
  }
}

export function clearCountryReturnContext(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Read + clear the context when it belongs to `path`. */
export function consumeCountryReturnContext(path: string): CountryReturnContext | null {
  const ctx = readCountryReturnContext();
  if (!ctx || ctx.path.split("?")[0] !== path.split("?")[0]) return null;
  clearCountryReturnContext();
  return ctx;
}
