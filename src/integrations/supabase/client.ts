// READ-ONLY PORTAL — Phase 1
// This client uses the public anon key only. The service-role key must NEVER
// appear in browser code. Do not call .insert / .update / .delete / .upsert
// or write-style .rpc() in this iteration; future phases (2A/2B/2C) will
// introduce mutations under explicit review.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://tbafuqwruefgkbyxrxyb.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiYWZ1cXdydWVmZ2tieXhyeHliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyOTY0NDcsImV4cCI6MjA5Mjg3MjQ0N30.tvOzn1ketbd0zYJWDujh_DGcWVDeitJaoVWw3aqtuRw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: localStorage,
  },
});
