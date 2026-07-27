// TEMPORARY diagnostic — verifies the SQL 129 backfill and the delete path for
// valve row connections against the vineyard backend. Deleted after the run.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = Deno.env.get("VINETRACK_SUPABASE_URL")!;
  const serviceKey = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY")!;
  const anon = Deno.env.get("VINETRACK_ANON_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const body = await req.json().catch(() => ({}));
  const email = body.email ?? "jonathan@stockmansridge.com.au";
  const doDelete = body.delete === true;

  const out: Record<string, unknown> = {};

  // Mint a short-lived session for the real user so RLS applies as in the app.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) return json({ error: `generateLink: ${linkErr.message}` });

  const props: any = (link as any).properties;
  const verify = await fetch(
    `${url}/auth/v1/verify?token=${props.hashed_token}&type=magiclink`,
    { headers: { apikey: anon }, redirect: "manual" },
  );
  const loc = verify.headers.get("location") ?? "";
  const frag = loc.split("#")[1] ?? "";
  const accessToken = new URLSearchParams(frag).get("access_token");
  if (!accessToken) return json({ error: "no access token", loc });

  const user = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  // Vineyard + valve discovery
  const { data: vineyards } = await user
    .from("vineyards")
    .select("id, name")
    .ilike("name", body.vineyard ?? "%Stockmans Ridge%");
  const vineyardId = vineyards?.[0]?.id;
  out.vineyard = vineyards?.[0];
  if (!vineyardId) return json(out);

  const { data: valves } = await user
    .from("irrigation_valves")
    .select("id, name")
    .eq("vineyard_id", vineyardId);
  out.valves = valves;
  const w1 = (valves ?? []).find((v: any) => /w1/i.test(v.name));
  out.w1 = w1;
  if (!w1) return json(out);

  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await (user as any).rpc(name, args);
    return error ? { error: error.message, details: (error as any).details, code: (error as any).code } : data;
  };

  out.valve_rows = await rpc("list_irrigation_valve_rows", {
    p_vineyard_id: vineyardId,
    p_valve_id: w1.id,
  });
  out.valve_blocks = await rpc("list_irrigation_valve_blocks", {
    p_vineyard_id: vineyardId,
    p_valve_id: w1.id,
  });

  if (doDelete) {
    out.delete_attempt = await rpc("set_irrigation_valve_rows", {
      p_vineyard_id: vineyardId,
      p_valve_id: w1.id,
      p_row_ids: [],
    });
    out.after_delete_rows = await rpc("list_irrigation_valve_rows", {
      p_vineyard_id: vineyardId,
      p_valve_id: w1.id,
    });
    out.after_delete_blocks = await rpc("list_irrigation_valve_blocks", {
      p_vineyard_id: vineyardId,
      p_valve_id: w1.id,
    });
    // Restore whatever was there before so live data is untouched.
    const restoreIds = extractRowIds(out.valve_rows);
    out.restore_ids = restoreIds;
    if (restoreIds.length > 0) {
      out.restore = await rpc("set_irrigation_valve_rows", {
        p_vineyard_id: vineyardId,
        p_valve_id: w1.id,
        p_row_ids: restoreIds,
      });
      out.after_restore_rows = await rpc("list_irrigation_valve_rows", {
        p_vineyard_id: vineyardId,
        p_valve_id: w1.id,
      });
    }
  }

  return json(out);

  function json(v: unknown) {
    return new Response(JSON.stringify(v, null, 2), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

function extractRowIds(payload: any): string[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.rows)
      ? payload.rows
      : Array.isArray(payload?.blocks)
        ? payload.blocks.flatMap((b: any) => b?.rows ?? [])
        : [];
  return list
    .map((r: any) => (typeof r === "string" ? r : (r?.row_id ?? r?.paddock_row_id ?? r?.id)))
    .filter(Boolean)
    .map(String);
}
