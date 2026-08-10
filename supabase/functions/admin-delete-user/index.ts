// System-admin only: permanently delete a VineTrack user, their data, and any
// vineyard where they are the sole owner.
//
// Caller must be an ACTIVE system admin on the VineTrack (iOS-shared) project.
// All writes go through the VineTrack service role.
//
// POST { user_id: string, mode: "preview" | "delete" }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
const jsonError = (status: number, message: string) => json(status, { error: message });

// Vineyard-scoped tables cleaned up before the vineyard row itself is removed.
// Ordered roughly child -> parent; the loop runs twice so FK ordering issues
// resolve on the second pass.
const VINEYARD_TABLES = [
  "irrigation_session_blocks",
  "irrigation_sessions",
  "irrigation_valve_rows",
  "irrigation_valve_blocks",
  "irrigation_valves",
  "irrigation_controller_valve_mappings",
  "irrigation_import_rows",
  "irrigation_import_batches",
  "irrigation_import_provider_settings",
  "irrigation_systems",
  "irrigation_audit",
  "work_task_labour_lines",
  "work_task_machine_lines",
  "work_task_paddocks",
  "work_tasks",
  "work_task_types",
  "trip_cost_allocations",
  "trips",
  "vineyard_trip_functions",
  "spray_records",
  "spray_jobs",
  "saved_spray_presets",
  "spray_equipment",
  "fertiliser_record_allocations",
  "fertiliser_records",
  "pruning_row_segments",
  "pruning_entry_audit",
  "pruning_entries",
  "pruning_activities",
  "pruning_seasons",
  "pruning_season_backfill_log",
  "pruning_season_mismatch_log",
  "yield_estimation_sessions",
  "historical_yield_records",
  "growth_stage_records",
  "damage_records",
  "maintenance_logs",
  "tractor_fuel_logs",
  "fuel_purchases",
  "tractors",
  "vineyard_machines",
  "equipment_items",
  "rainfall_daily",
  "vineyard_weather_observations",
  "vineyard_weather_integrations",
  "vineyard_alerts",
  "vineyard_alert_preferences",
  "vineyard_button_configs",
  "vineyard_custom_pin_types",
  "vineyard_growth_stage_images",
  "vineyard_grape_varieties",
  "pins",
  "paddock_soil_profiles",
  "paddocks",
  "saved_chemicals",
  "saved_inputs",
  "operator_categories",
  "worker_types",
  "support_requests",
  "invitations",
  "webhook_subscriptions",
  "integration_client_vineyards",
  "integration_environment_cache",
  "integration_audit_log",
  "integration_api_requests",
  "audit_events",
  "vinetrack_invoice_records",
  "vinetrack_user_licences",
  "vineyard_members",
];

// User-scoped tables cleaned up before the profile / auth user is removed.
const USER_TABLES = [
  "user_operational_tool_preferences",
  "disclaimer_acceptances",
  "vineyard_alert_user_status",
  "vinetrack_entitlement_audit",
  "vinetrack_entitlement_state",
  "vinetrack_account_trials",
  "vinetrack_user_licences",
  "account_deletion_requests",
  "support_requests",
  "irrigation_audit",
  "audit_events",
  "vineyard_members",
  "system_admins",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  const URL_ = Deno.env.get("VINETRACK_SUPABASE_URL");
  const SERVICE = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY");
  const ANON = Deno.env.get("VINETRACK_ANON_KEY");
  if (!URL_ || !SERVICE || !ANON) return jsonError(503, "VineTrack backend is not configured.");

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonError(401, "Unauthorized");

  const userClient = createClient(URL_, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonError(401, "Unauthorized");
  const caller = userData.user;

  const { data: isAdmin, error: adminErr } = await userClient.rpc("is_system_admin");
  if (adminErr) return jsonError(403, "Could not verify system admin access.");
  if (!isAdmin) return jsonError(403, "System admin access required.");

  let body: { user_id?: string; mode?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const targetId = (body.user_id ?? "").trim();
  const mode = body.mode === "delete" ? "delete" : "preview";
  if (!targetId) return jsonError(400, "user_id is required");
  if (targetId === caller.id) return jsonError(400, "You cannot delete your own account.");

  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

  // --- Target user -----------------------------------------------------
  const { data: authUser } = await admin.auth.admin.getUserById(targetId);
  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", targetId)
    .maybeSingle();
  const email = (profile as any)?.email ?? authUser?.user?.email ?? null;
  if (!authUser?.user && !profile) return jsonError(404, "User not found.");

  // --- Vineyard impact --------------------------------------------------
  const { data: memberships, error: memErr } = await admin
    .from("vineyard_members")
    .select("vineyard_id, role")
    .eq("user_id", targetId);
  if (memErr) return jsonError(500, `Could not load memberships: ${memErr.message}`);

  const vineyardIds = Array.from(new Set((memberships ?? []).map((m: any) => m.vineyard_id).filter(Boolean)));

  const { data: ownedVineyards } = await admin
    .from("vineyards")
    .select("id, name, owner_id")
    .eq("owner_id", targetId);
  for (const v of ownedVineyards ?? []) {
    if (!vineyardIds.includes((v as any).id)) vineyardIds.push((v as any).id);
  }

  const soleOwner: Array<{ id: string; name: string | null }> = [];
  const shared: Array<{ id: string; name: string | null; reason: string }> = [];

  for (const vid of vineyardIds) {
    const { data: vy } = await admin
      .from("vineyards")
      .select("id, name, owner_id")
      .eq("id", vid)
      .maybeSingle();
    if (!vy) continue;
    const { data: owners } = await admin
      .from("vineyard_members")
      .select("user_id, role")
      .eq("vineyard_id", vid)
      .eq("role", "owner");
    const otherOwners = (owners ?? []).filter((o: any) => o.user_id !== targetId);
    const isOwner = (vy as any).owner_id === targetId ||
      (owners ?? []).some((o: any) => o.user_id === targetId);
    if (isOwner && otherOwners.length === 0) {
      soleOwner.push({ id: vid, name: (vy as any).name ?? null });
    } else {
      shared.push({
        id: vid,
        name: (vy as any).name ?? null,
        reason: isOwner ? "Other owners remain" : "User is not an owner",
      });
    }
  }

  const summary = {
    user: { id: targetId, email, full_name: (profile as any)?.full_name ?? null },
    vineyards_to_delete: soleOwner,
    vineyards_to_keep: shared,
  };

  if (mode === "preview") return json(200, { mode: "preview", ...summary });

  // --- Deletion ---------------------------------------------------------
  const errors: string[] = [];
  const deletedTables: Record<string, true> = {};

  const soleOwnerIds = soleOwner.map((v) => v.id);
  if (soleOwnerIds.length > 0) {
    for (let pass = 0; pass < 2; pass++) {
      for (const table of VINEYARD_TABLES) {
        const { error } = await admin.from(table).delete().in("vineyard_id", soleOwnerIds);
        if (!error) { deletedTables[table] = true; continue; }
        const code = (error as any).code ?? "";
        // Missing table / column — ignore silently.
        if (code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205") continue;
        if (pass === 1) errors.push(`${table}: ${error.message}`);
      }
    }
    const { error: vErr } = await admin.from("vineyards").delete().in("id", soleOwnerIds);
    if (vErr) errors.push(`vineyards: ${vErr.message}`);
  }

  for (let pass = 0; pass < 2; pass++) {
    for (const table of USER_TABLES) {
      const { error } = await admin.from(table).delete().eq("user_id", targetId);
      if (!error) continue;
      const code = (error as any).code ?? "";
      if (code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205") continue;
      if (pass === 1) errors.push(`${table}: ${error.message}`);
    }
  }

  const { error: profErr } = await admin.from("profiles").delete().eq("id", targetId);
  if (profErr) errors.push(`profiles: ${profErr.message}`);

  const { error: authDelErr } = await admin.auth.admin.deleteUser(targetId);
  if (authDelErr) {
    return json(500, {
      error: `User data removed, but the login could not be deleted: ${authDelErr.message}`,
      partial: true,
      errors,
      ...summary,
    });
  }

  return json(200, {
    mode: "delete",
    success: true,
    errors,
    deleted_vineyards: soleOwner,
    kept_vineyards: shared,
    user: summary.user,
  });
});
