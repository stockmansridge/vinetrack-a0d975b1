// Canonical upsert for public.email_list_subscribers.
//
// The authoritative subscriber store is the canonical VineTrack database
// (alongside public.support_requests) — see sql/242_email_list_subscribers.sql.
// The Portal's own project holds a legacy copy of the table from the first
// round of this feature; it is only used as a temporary fallback until the
// canonical table is live, and is retired afterwards.
//
// One row per email address, matched case-insensitively. Re-subscribing an
// unsubscribed address restores it instead of creating a duplicate.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface SubscriberInput {
  email: string; // already normalised (trimmed + lowercased)
  first_name?: string | null;
  last_name?: string | null;
  source: string;
  source_page?: string | null;
  consent_text?: string | null;
  consent_version?: string | null;
}

export type SubscriberOutcome = "created" | "updated";

export const SUBSCRIBER_COLUMNS =
  "id, email, first_name, last_name, status, source, source_page, consent_version, subscribed_at, unsubscribed_at, created_at, updated_at";

/** PostgREST / Postgres codes meaning "this table does not exist here". */
export function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "PGRST200" || error.code === "42P01") return true;
  return /could not find the table/i.test(error.message ?? "");
}

export type UpsertResult =
  | { ok: true; outcome: SubscriberOutcome }
  | { ok: false; error: string; missingTable: boolean };

/**
 * Insert or restore a subscriber. Never reveals to the caller whether the
 * address already existed — that is the caller's responsibility.
 */
export async function upsertSubscriber(
  admin: SupabaseClient,
  input: SubscriberInput,
): Promise<UpsertResult> {
  const now = new Date().toISOString();
  const patch = {
    email: input.email,
    status: "subscribed",
    source: input.source,
    source_page: input.source_page ?? null,
    consent_text: input.consent_text ?? null,
    consent_version: input.consent_version ?? null,
    consent_captured_at: now,
    subscribed_at: now,
    unsubscribed_at: null,
    updated_at: now,
  } as Record<string, unknown>;

  const existing = await admin
    .from("email_list_subscribers")
    .select("id, first_name, last_name")
    .ilike("email", input.email)
    .maybeSingle();

  if (existing.error) {
    return {
      ok: false,
      error: existing.error.message,
      missingTable: isMissingTableError(existing.error),
    };
  }

  if (existing.data) {
    const row = existing.data as { id: string; first_name: string | null; last_name: string | null };
    // Only overwrite names when the new submission actually supplies one.
    const update = {
      ...patch,
      first_name: input.first_name?.trim() ? input.first_name : row.first_name,
      last_name: input.last_name?.trim() ? input.last_name : row.last_name,
    };
    const { error } = await admin
      .from("email_list_subscribers")
      .update(update)
      .eq("id", row.id);
    if (error) return { ok: false, error: error.message, missingTable: isMissingTableError(error) };
    return { ok: true, outcome: "updated" };
  }

  const insert = await admin.from("email_list_subscribers").insert({
    ...patch,
    first_name: input.first_name?.trim() ? input.first_name : null,
    last_name: input.last_name?.trim() ? input.last_name : null,
  });

  if (insert.error) {
    // Lost a race against a concurrent submission of the same address —
    // fall back to the update path so we still keep one canonical row.
    if (insert.error.code === "23505") {
      const { error } = await admin
        .from("email_list_subscribers")
        .update(patch)
        .ilike("email", input.email);
      if (error) return { ok: false, error: error.message, missingTable: isMissingTableError(error) };
      return { ok: true, outcome: "updated" };
    }
    return {
      ok: false,
      error: insert.error.message,
      missingTable: isMissingTableError(insert.error),
    };
  }
  return { ok: true, outcome: "created" };
}

/**
 * Write to the canonical VineTrack list. While sql/242 is not yet applied to
 * the canonical database, fall back to the legacy Portal-project table so no
 * genuine subscriber is ever lost during the cutover window.
 */
export async function upsertSubscriberCanonical(
  canonical: SupabaseClient,
  legacy: SupabaseClient | null,
  input: SubscriberInput,
): Promise<UpsertResult & { store: "vinetrack" | "legacy" }> {
  const primary = await upsertSubscriber(canonical, input);
  if (primary.ok) return { ...primary, store: "vinetrack" };
  if (!primary.missingTable || !legacy) return { ...primary, store: "vinetrack" };

  console.error(
    "email_list_subscribers missing on the canonical VineTrack project — apply sql/242; using legacy table",
  );
  const fallback = await upsertSubscriber(legacy, input);
  return { ...fallback, store: "legacy" };
}
