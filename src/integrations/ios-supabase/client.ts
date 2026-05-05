// READ-ONLY client for the iOS app's Supabase project.
// This is separate from Lovable Cloud (which is used only for edge functions
// like get-mapkit-token). The anon key is safe to ship; RLS is the authority.
// Do NOT call .insert / .update / .delete / .upsert / write rpc with this client.
import { createClient } from "@supabase/supabase-js";

const IOS_SUPABASE_URL = "https://tbafuqwruefgkbyxrxyb.supabase.co";
const IOS_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiYWZ1cXdydWVmZ2tieXhyeHliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyOTY0NDcsImV4cCI6MjA5Mjg3MjQ0N30.tvOzn1ketbd0zYJWDujh_DGcWVDeitJaoVWw3aqtuRw";

export const iosSupabase = createClient(IOS_SUPABASE_URL, IOS_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: localStorage,
    storageKey: "ios-supabase-auth",
  },
});

// Backwards-compat alias used across the read-only portal code.
export const supabase = iosSupabase;
