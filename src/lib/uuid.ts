// Shared UUID v4 generator.
//
// Safari (and any non-secure context) may not expose `crypto.randomUUID`.
// Calling it unguarded during render crashes the screen, so every production
// caller must go through `generateUuid()`.
//
//  1. `crypto.randomUUID()` when available.
//  2. RFC 4122 v4 built from `crypto.getRandomValues()`.
//  3. Otherwise throw an actionable error — we never emit a weak/random-ish id
//     that would end up stored against vineyard records.

export class SecureRandomUnavailableError extends Error {
  constructor() {
    super(
      "This browser does not provide a secure random number generator, so VineTrack cannot create a record id. Update your browser, or open the portal over https.",
    );
    this.name = "SecureRandomUnavailableError";
  }
}

function getCrypto(): Crypto | undefined {
  if (typeof globalThis === "undefined") return undefined;
  return (globalThis as { crypto?: Crypto }).crypto;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function generateUuid(): string {
  const c = getCrypto();

  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      /* fall through to getRandomValues */
    }
  }

  if (c && typeof c.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex: string[] = [];
    for (let i = 0; i < 16; i += 1) hex.push(bytes[i].toString(16).padStart(2, "0"));
    return (
      hex.slice(0, 4).join("") +
      "-" +
      hex.slice(4, 6).join("") +
      "-" +
      hex.slice(6, 8).join("") +
      "-" +
      hex.slice(8, 10).join("") +
      "-" +
      hex.slice(10, 16).join("")
    );
  }

  throw new SecureRandomUnavailableError();
}

/** Human-readable message for a failed id generation. */
export function uuidErrorMessage(e: unknown): string {
  if (e instanceof SecureRandomUnavailableError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/** Never-throwing variant for render paths (component state initialisers). */
export function tryGenerateUuid(): { id: string | null; error: string | null } {
  try {
    return { id: generateUuid(), error: null };
  } catch (e) {
    return { id: null, error: uuidErrorMessage(e) };
  }
}
