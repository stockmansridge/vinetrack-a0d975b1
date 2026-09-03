/**
 * Regression coverage — Portal signup / OAuth signup are ACCOUNT-ONLY flows.
 *
 * Proves that a brand-new account with:
 *   • no Apple (App Store) subscription
 *   • no Google Play subscription
 *   • no existing vineyard
 *   • no mobile app installation
 * can sign up, create its first vineyard, and enter the Portal purely on the
 * server-returned `active_trial` entitlement.
 *
 * Also proves the Portal never creates trial rows client-side and never
 * computes the 3-month trial window: every trial date is read verbatim from
 * the shared backend payload (which derives it from auth.users.created_at).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";

/* ------------------------------------------------------------------ */
/* Recording Supabase double                                           */
/* ------------------------------------------------------------------ */

const { calls } = vi.hoisted(() => ({ calls: {
  signUp: [] as unknown[],
  rpc: [] as { name: string; args: unknown }[],
  tableWrites: [] as { table: string; op: string; payload: unknown }[],
  tableReads: [] as string[],
} }));

let matrixPayload: unknown = { vineyards: [] };

function tableStub(table: string) {
  const write = (op: string) => (payload: unknown) => {
    calls.tableWrites.push({ table, op, payload });
    return Promise.resolve({ data: null, error: null });
  };
  const chain: Record<string, unknown> = {
    insert: write("insert"),
    upsert: write("upsert"),
    update: write("update"),
    delete: write("delete"),
    select: () => {
      calls.tableReads.push(table);
      return chain;
    },
    eq: () => chain,
    order: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (r: (v: { data: unknown[]; error: null }) => unknown) =>
      r({ data: [], error: null }),
  };
  return chain;
}

const supabaseStub: any = {
  auth: {
    signUp: (args: unknown) => {
      calls.signUp.push(args);
      // Email confirmation enabled → no session, no client-side provisioning.
      return Promise.resolve({ data: { user: null, session: null }, error: null });
    },
    signInWithOAuth: (args: unknown) => {
      calls.signUp.push(args);
      return Promise.resolve({ data: {}, error: null });
    },
    getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  from: (table: string) => tableStub(table),
  rpc: (name: string, args?: unknown) => {
    calls.rpc.push({ name, args: args ?? {} });
    if (name === "get_my_vineyard_access_matrix")
      return Promise.resolve({ data: matrixPayload, error: null });
    if (name === "create_vineyard_with_owner")
      return Promise.resolve({
        data: {
          id: "vy-1",
          name: "First Vineyard",
          owner_id: "user-1",
          country: null,
          logo_path: null,
          logo_updated_at: null,
          created_at: "2026-09-03T00:00:00Z",
          updated_at: "2026-09-03T00:00:00Z",
          deleted_at: null,
          latitude: null,
          longitude: null,
          elevation_metres: null,
          timezone: null,
        },
        error: null,
      });
    return Promise.resolve({ data: null, error: null });
  },
};

vi.mock("@/integrations/ios-supabase/client", () => ({
  get supabase() { return supabaseStub; },
  get iosSupabase() { return supabaseStub; },
  IOS_SUPABASE_URL: "https://example.test",
  IOS_SUPABASE_ANON_KEY: "anon",
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "new@vineyard.test" },
    session: null,
    loading: false,
    signOut: vi.fn(),
  }),
}));

import SignUp from "@/pages/SignUp";
import { createVineyardWithOwner } from "@/lib/vineyardSettingsQuery";
import { useVineyardAccessMatrix, vineyardAccessState } from "@/lib/vineyardAccessQuery";

/** Tables that would mean the Portal is provisioning entitlement itself. */
const ENTITLEMENT_TABLES =
  /(subscription|trial|licence|license|entitlement|billing|purchase|receipt|store_)/i;

function reset() {
  calls.signUp = [];
  calls.rpc = [];
  calls.tableWrites = [];
  calls.tableReads = [];
}

beforeEach(reset);

/* ------------------------------------------------------------------ */
/* 1 — Signup is account-only                                          */
/* ------------------------------------------------------------------ */

describe("Portal signup is an account-only flow", () => {
  it("creates only an auth account — no store purchase, no trial row", async () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <SignUp />
        </MemoryRouter>
      </HelmetProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText("Full name"), {
      target: { value: "New Grower" },
    });
    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "new@vineyard.test" },
    });
    fireEvent.change(screen.getByPlaceholderText(/^Password/), {
      target: { value: "correct-horse" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm password"), {
      target: { value: "correct-horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(calls.signUp).toHaveLength(1));

    const args = calls.signUp[0] as { email: string; password: string };
    expect(args.email).toBe("new@vineyard.test");
    expect(args.password).toBe("correct-horse");

    // No App Store / Play receipt, no country gate, no entitlement writes.
    expect(JSON.stringify(args)).not.toMatch(
      /receipt|app_?store|play_?store|apple_?subscription|country_code/i,
    );
    expect(calls.rpc).toHaveLength(0);
    expect(
      calls.tableWrites.filter((w) => ENTITLEMENT_TABLES.test(w.table)),
    ).toEqual([]);
  });

  it("OAuth signup buttons carry no store/platform entitlement parameters", () => {
    const src = readFileSync("src/components/auth/GoogleSignInButton.tsx", "utf8")
      + readFileSync("src/components/auth/AppleSignInButton.tsx", "utf8");
    expect(src).not.toMatch(/receipt|app_?store|play_?store|entitlement|subscription/i);
  });
});

/* ------------------------------------------------------------------ */
/* 2 — First vineyard creation                                         */
/* ------------------------------------------------------------------ */

describe("First vineyard creation requires no subscription", () => {
  it("calls only create_vineyard_with_owner and writes no entitlement rows", async () => {
    const vineyard = await createVineyardWithOwner({ name: "First Vineyard", country: null });
    expect(vineyard.id).toBe("vy-1");
    expect(calls.rpc.map((c) => c.name)).toEqual(["create_vineyard_with_owner"]);
    expect(calls.tableWrites).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 3 — Server-returned active_trial admits the new account             */
/* ------------------------------------------------------------------ */

function Probe() {
  const { data, isLoading } = useVineyardAccessMatrix();
  if (isLoading || !data) return <div>loading</div>;
  const row = data.vineyards[0];
  return (
    <div>
      <span data-testid="state">{vineyardAccessState(row)}</span>
      <span data-testid="can-enter">{String(row.can_enter_vineyard)}</span>
      <span data-testid="source">{row.vineyard_access_source ?? ""}</span>
      <span data-testid="reason">{row.vineyard_access_reason ?? ""}</span>
      <span data-testid="starts">{row.starts_at ?? ""}</span>
      <span data-testid="expires">{row.expires_at ?? ""}</span>
    </div>
  );
}

async function renderProbe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("state")).toBeInTheDocument());
}

describe("New account enters the Portal on the server-returned active trial", () => {
  it("uses the backend trial window verbatim (auth.users.created_at + backend rule)", async () => {
    // auth.users.created_at = 2026-09-03T04:11:07Z; backend returns the
    // 3-month window. The Portal must echo these exact strings.
    matrixPayload = {
      has_any_accessible_vineyard: true,
      accessible_vineyard_count: 1,
      pending_invitation_count: 0,
      can_create_vineyard: true,
      account_access_state: "active_trial",
      vineyards: [
        {
          vineyard_id: "vy-1",
          vineyard_name: "First Vineyard",
          membership_role: "owner",
          has_vineyard_access: true,
          can_enter_vineyard: true,
          vineyard_access_reason: "active_trial",
          vineyard_access_source: "trial",
          plan_code: null,
          subscription_status: "trialing",
          starts_at: "2026-09-03T04:11:07Z",
          expires_at: "2026-12-03T04:11:07Z",
          is_trial: true,
          is_vineyard_wide: true,
          is_billing_owner: true,
          can_manage_billing: true,
          is_billing_authority: true,
          requires_billing_attention: false,
          last_verified_at: "2026-09-03T04:11:08Z",
        },
      ],
    };

    await renderProbe();

    expect(screen.getByTestId("can-enter")).toHaveTextContent("true");
    expect(screen.getByTestId("state")).toHaveTextContent("trial");
    expect(screen.getByTestId("source")).toHaveTextContent("trial");
    expect(screen.getByTestId("reason")).toHaveTextContent("active_trial");
    // Dates are echoed, never recomputed.
    expect(screen.getByTestId("starts")).toHaveTextContent("2026-09-03T04:11:07Z");
    expect(screen.getByTestId("expires")).toHaveTextContent("2026-12-03T04:11:07Z");
    // Reading access never writes anything.
    expect(calls.tableWrites).toEqual([]);
    expect(calls.rpc.map((c) => c.name)).toEqual(["get_my_vineyard_access_matrix"]);
  });

  it("denies entry only when the server says so — no local fallback grant", async () => {
    matrixPayload = {
      vineyards: [
        {
          vineyard_id: "vy-1",
          vineyard_name: "First Vineyard",
          membership_role: "owner",
          has_vineyard_access: false,
          can_enter_vineyard: false,
          vineyard_access_reason: "expired",
          vineyard_access_source: "trial",
          starts_at: "2026-09-03T04:11:07Z",
          expires_at: "2026-12-03T04:11:07Z",
          is_trial: true,
        },
      ],
    };
    await renderProbe();
    expect(screen.getByTestId("can-enter")).toHaveTextContent("false");
    expect(screen.getByTestId("state")).toHaveTextContent("expired");
    expect(calls.tableWrites).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 4 — Static guarantees across the Portal source                      */
/* ------------------------------------------------------------------ */

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "test") continue;
      sourceFiles(p, acc);
    } else if (/\.tsx?$/.test(entry)) acc.push(p);
  }
  return acc;
}

describe("Portal never provisions entitlement client-side", () => {
  const files = sourceFiles("src");

  it("has no client-side write to a trial / subscription / licence table", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const re =
        /\.from\(\s*["'`]([a-z_]*(subscription|trial|licence|license|entitlement)[a-z_]*)["'`]\s*\)[\s\S]{0,200}?\.(insert|upsert|update|delete)\(/g;
      if (re.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("never computes a 3-month trial window locally", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!/trial/i.test(src)) continue;
      // Any month arithmetic or 90-day constant near trial handling is a leak.
      if (/(setMonth|addMonths|\b90\s*\*\s*24|months?\s*[:=]\s*3\b)/.test(src))
        offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("applies no platform-specific or country-based entitlement logic", () => {
    const offenders: string[] = [];
    // Scope: the auth / access / entitlement surfaces only.
    const gated = files.filter((f) =>
      /(auth|access|entitle|billing|onboard|signup|login|invite)/i.test(f),
    );
    for (const f of gated) {
      const src = readFileSync(f, "utf8");
      // Store names may appear as display labels; gating on them may not.
      if (
        /(if\s*\(|&&|\|\|)[^\n]*\b(isIOS|isAndroid|hasAppStoreSubscription|hasPlaySubscription|requiresAppInstall)\b/.test(
          src,
        )
      )
        offenders.push(f);
      if (/(country|region)[A-Za-z_]*\s*[!=]==?\s*["'][A-Z]{2}["']/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
