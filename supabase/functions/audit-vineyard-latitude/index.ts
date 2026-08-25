// TEMPORARY read-only audit of vineyard latitude coverage. No writes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = createClient(
    Deno.env.get("VINETRACK_SUPABASE_URL")!,
    Deno.env.get("VINETRACK_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const v = await db
    .from("vineyards")
    .select("id,name,latitude,longitude,country_code,season_start_month,season_start_day,deleted_at")
    .order("name");
  const jh = ((v.data ?? []) as any[]).find((r) => /JH Testing/i.test(r.name));
  let jhPaddocks: unknown = null;
  if (jh) {
    const p = await db
      .from("paddocks")
      .select("id,name,polygon_points")
      .eq("vineyard_id", jh.id)
      .is("deleted_at", null)
      .limit(3);
    jhPaddocks = p.data ?? p.error?.message;
  }
  return new Response(
    JSON.stringify({ vineyards: v.data ?? v.error?.message, jhPaddocks }, null, 2),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
