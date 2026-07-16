// Client for the iOS app's Supabase project (the source of truth for
// vineyard data). The portal reuses iOS RPCs and table writes where the
// underlying RLS permits it — e.g. vineyard settings, location, logo.
// Lovable Cloud (separate Supabase project) is only used for portal-only
// concerns like edge functions (get-mapkit-token, support requests) and
// user-table preferences. The anon key is safe to ship; RLS is the
// authority for what the signed-in user may read or write.
import { createClient } from "@supabase/supabase-js";

export const IOS_SUPABASE_URL = "https://tbafuqwruefgkbyxrxyb.supabase.co";
const IOS_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiYWZ1cXdydWVmZ2tieXhyeHliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyOTY0NDcsImV4cCI6MjA5Mjg3MjQ0N30.tvOzn1ketbd0zYJWDujh_DGcWVDeitJaoVWw3aqtuRw";

export const iosSupabase = createClient(IOS_SUPABASE_URL, IOS_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: localStorage,
    storageKey: "ios-supabase-auth",
    // OAuth returns from Google/Apple use PKCE (?code=...). Handle the
    // exchange explicitly in /auth/callback so guards don't race the
    // client's URL detection and bounce the user to /login.
    flowType: "pkce",
    detectSessionInUrl: false,
  },
});

// Backwards-compat alias used across the read-only portal code.
export const supabase = iosSupabase;
