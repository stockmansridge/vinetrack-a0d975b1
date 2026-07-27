// Temporary diagnostic: verifies SQL 127/128 irrigation row RPCs against the
// VineTrack (vineyard) backend as the requesting owner account. Not referenced by the app.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = Deno.env.get("VINETRACK_SUPABASE_URL")!;
  const key = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY")!;
  const anon = Deno.env.get("VINETRACK_ANON_KEY")!;
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const body = await req.json().catch(() => ({}));
  const vineyardId = body.vineyard_id ?? "fe952afe-437f-4be7-8cbf-fdd8e630411c";
  const email = body.email ?? "jonathan@stockmansridge.com.au";
  const valveId = body.valve_id ?? null;
  const blockId = body.block_id ?? null;

  const out: Record<string, unknown> = {};

  // Mint a short-lived session for the owner account (no email is sent).
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) {
    return new Response(JSON.stringify({ linkErr }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const user = createClient(url, anon, { auth: { persistSession: false } });
  const { data: sess, error: otpErr } = await user.auth.verifyOtp({
    type: "magiclink",
    token_hash: (link.properties as any).hashed_token,
  });
  out.session_user = otpErr ? { otpErr } : sess.user?.id;

  const run = async (label: string, fn: string, args: Record<string, unknown>) => {
    const { data, error } = await user.rpc(fn, args);
    out[label] = error ? { error } : data;
  };

  await run("valves", "list_irrigation_valves", { p_vineyard_id: vineyardId, p_include_inactive: true });
  if (blockId) {
    await run("available_rows", "list_irrigation_available_rows", {
      p_block_id: blockId,
      p_vineyard_id: vineyardId,
    });
  }
  if (valveId) {
    await run("valve_rows", "list_irrigation_valve_rows", {
      p_vineyard_id: vineyardId,
      p_valve_id: valveId,
    });
    await run("valve_blocks", "list_irrigation_valve_blocks", {
      p_vineyard_id: vineyardId,
      p_valve_id: valveId,
    });
  }

  await user.auth.signOut();

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
