// Audience resolution for the VineTrack Newsletter Builder.
//
// Pure functions — no network, no Supabase client — so the set logic is fully
// testable (src/test/newsletterAudience.test.ts).
//
//   A = Current Users            (admin_list_users on the canonical VineTrack DB)
//   B = Newsletter Subscribers   (email_list_subscribers, status = subscribed)
//   final = (A ∪ B) − suppressed − unsubscribed − invalid, deduped on the
//           normalised email address.

export type RecipientSource = "current_user" | "newsletter_subscriber" | "both";

export interface AudienceInputs {
  /** Raw emails from Current Users (any casing/whitespace). */
  currentUsers: (string | null | undefined)[];
  /** Raw emails of subscribers whose status is 'subscribed'. */
  subscribers: (string | null | undefined)[];
  /** Raw emails of subscribers whose status is 'unsubscribed'. */
  unsubscribed?: (string | null | undefined)[];
  /** Suppressed addresses (bounce/complaint/unsubscribe) from email infrastructure. */
  suppressed?: (string | null | undefined)[];
  includeCurrentUsers: boolean;
  includeSubscribers: boolean;
}

export interface ResolvedRecipient {
  email: string;
  source: RecipientSource;
}

export interface AudienceCounts {
  current_users: number;
  subscribers: number;
  in_both: number;
  unique_potential: number;
  suppressed: number;
  invalid: number;
  final: number;
}

export interface ResolvedAudience {
  recipients: ResolvedRecipient[];
  counts: AudienceCounts;
}

/** trim + lowercase. Returns "" for blank input. */
export function normaliseEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Conservative address check — one @, a dot in the domain, no whitespace. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@,;:<>()[\]\\"]+@[^\s@.,;:<>()[\]\\"]+(\.[^\s@.,;:<>()[\]\\"]+)+$/.test(value);
}

function normaliseSet(values: (string | null | undefined)[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const value of values ?? []) {
    const email = normaliseEmail(value);
    if (email) out.add(email);
  }
  return out;
}

/**
 * Resolves the final send list. Counts describe the selected audiences only:
 * a list that is not ticked contributes nothing.
 */
export function resolveAudience(input: AudienceInputs): ResolvedAudience {
  const invalidSeen = new Set<string>();
  const blankCount = { n: 0 };

  const collect = (values: (string | null | undefined)[]): Set<string> => {
    const valid = new Set<string>();
    for (const raw of values ?? []) {
      const email = normaliseEmail(raw);
      if (!email) {
        blankCount.n += 1;
        continue;
      }
      if (!isValidEmail(email)) {
        invalidSeen.add(email);
        continue;
      }
      valid.add(email);
    }
    return valid;
  };

  const usersAll = collect(input.includeCurrentUsers ? input.currentUsers : []);
  const subsAll = collect(input.includeSubscribers ? input.subscribers : []);

  const suppressed = normaliseSet(input.suppressed);
  const unsubscribed = normaliseSet(input.unsubscribed);
  // A VineTrack unsubscribe applies to the person, not to one list — a current
  // user who unsubscribed is excluded even when only Current Users is ticked.
  const blocked = new Set<string>([...suppressed, ...unsubscribed]);

  const union = new Set<string>([...usersAll, ...subsAll]);
  let inBoth = 0;
  for (const email of usersAll) if (subsAll.has(email)) inBoth += 1;

  const recipients: ResolvedRecipient[] = [];
  let suppressedCount = 0;
  for (const email of union) {
    if (blocked.has(email)) {
      suppressedCount += 1;
      continue;
    }
    const inUsers = usersAll.has(email);
    const inSubs = subsAll.has(email);
    recipients.push({
      email,
      source: inUsers && inSubs ? "both" : inUsers ? "current_user" : "newsletter_subscriber",
    });
  }
  recipients.sort((a, b) => a.email.localeCompare(b.email));

  return {
    recipients,
    counts: {
      current_users: usersAll.size,
      subscribers: subsAll.size,
      in_both: inBoth,
      unique_potential: union.size,
      suppressed: suppressedCount,
      invalid: invalidSeen.size + blankCount.n,
      final: recipients.length,
    },
  };
}

/** Stable per-recipient send key — identical across retries of one version. */
export function recipientIdempotencyKey(versionId: string, email: string): string {
  return `nl_${versionId}_${normaliseEmail(email)}`;
}
