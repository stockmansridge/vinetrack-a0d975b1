-- ============================================================================
-- SQL 251 — System Admin Trip surgical repairs (requires SQL 250)
-- ============================================================================
-- Adds two System Admin RPCs that correct ONLY provably stale state:
--
--   admin_reconcile_trip_runtime(p_trip_id uuid, p_reason text) -> jsonb
--     * Completion repair: Trip already has end_time but runtime flags still
--       claim it is running -> is_active/is_paused/filling off, active tank and
--       filling tank cleared. Existing end_time preserved; no new timestamp.
--     * Tank repair (Trip not completed): active_tank_number set, a matching
--       Tank Session exists, every matching session has ended, and no fill
--       timer is open anywhere -> active_tank_number = NULL.
--       Refused (P0001) if the tank has a genuinely open session.
--     * Fill repair (Trip not completed): is_filling_tank / filling_tank_number
--       set but no matching open fill session -> both cleared. A genuine open
--       fill session is never touched.
--     Never sets end_time, never closes the Trip or Spray Record, never
--     touches tank_sessions, tank actuals, chemicals, path_points, blocks.
--     Nothing to repair -> returns 'nothing_to_repair', no write, no audit
--     (idempotent).
--
--   admin_close_spray_record_from_trip(p_trip_id uuid, p_reason text) -> jsonb
--     Only when the Trip has a persisted end_time and its linked Spray Record
--     has none: sets spray_records.end_time to the Trip's end_time, bumps its
--     sync_version. Tanks, actuals, weather, blocks and the Trip are untouched.
--     Already closed -> 'already_closed', no write, no audit.
--     There is deliberately NO reopen RPC.
--
-- Both: SECURITY DEFINER, explicit is_system_admin(), mandatory reason,
-- FOR UPDATE row locks, one transaction, audit_events entry per real change.
-- SQL 250 is not modified.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._admin_json_present(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT v IS NOT NULL AND jsonb_typeof(v) <> 'null' AND v::text <> '""'
$$;
REVOKE ALL ON FUNCTION public._admin_json_present(jsonb) FROM public, anon;

-- ---------- admin_reconcile_trip_runtime ----------

CREATE OR REPLACE FUNCTION public.admin_reconcile_trip_runtime(
  p_trip_id uuid,
  p_reason  text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t_old public.trips%ROWTYPE;
  t_new public.trips%ROWTYPE;
  v_sessions jsonb;
  v_repairs text[] := ARRAY[]::text[];
  v_clear_tank boolean := false;
  v_clear_fill boolean := false;
  v_completion boolean := false;
  v_tank_matches int;
  v_tank_open boolean;
  v_any_fill_open boolean;
  v_fill_open boolean;
  v_audit_id uuid;
BEGIN
  IF NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A support reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO t_old FROM public.trips WHERE id = p_trip_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'P0002';
  END IF;

  v_sessions := public._admin_tank_session_summary(t_old.tank_sessions);

  IF t_old.end_time IS NOT NULL THEN
    IF COALESCE(t_old.is_active, false) OR COALESCE(t_old.is_paused, false)
       OR t_old.active_tank_number IS NOT NULL OR COALESCE(t_old.is_filling_tank, false)
       OR t_old.filling_tank_number IS NOT NULL THEN
      v_completion := true;
      v_repairs := v_repairs || 'completion';
    END IF;
  ELSE
    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_sessions) e
                    WHERE public._admin_json_present(e->'fillStartTime')
                      AND NOT public._admin_json_present(e->'fillEndTime'))
      INTO v_any_fill_open;

    IF t_old.active_tank_number IS NOT NULL THEN
      SELECT count(*),
             bool_or(public._admin_json_present(e->'startTime') AND NOT public._admin_json_present(e->'endTime'))
        INTO v_tank_matches, v_tank_open
        FROM jsonb_array_elements(v_sessions) e
       WHERE (e->>'tankNumber')::numeric = t_old.active_tank_number;
      IF v_tank_matches > 0 AND NOT COALESCE(v_tank_open, false) AND NOT v_any_fill_open THEN
        v_clear_tank := true;
        v_repairs := v_repairs || 'tank';
      ELSIF COALESCE(v_tank_open, false) THEN
        -- genuinely open tank: never cleared here
        NULL;
      END IF;
    END IF;

    IF COALESCE(t_old.is_filling_tank, false) OR t_old.filling_tank_number IS NOT NULL THEN
      SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_sessions) e
                      WHERE public._admin_json_present(e->'fillStartTime')
                        AND NOT public._admin_json_present(e->'fillEndTime')
                        AND (t_old.filling_tank_number IS NULL
                             OR (e->>'tankNumber')::numeric = t_old.filling_tank_number))
        INTO v_fill_open;
      IF NOT v_fill_open THEN
        v_clear_fill := true;
        v_repairs := v_repairs || 'fill';
      END IF;
    END IF;
  END IF;

  IF array_length(v_repairs, 1) IS NULL THEN
    IF COALESCE(v_tank_open, false) THEN
      RAISE EXCEPTION 'Tank % has a genuinely open Tank Session. The tank must be ended on the device (or the Trip force-stopped); it cannot be cleared as stale.',
        t_old.active_tank_number USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('status', 'nothing_to_repair', 'trip_id', t_old.id, 'repairs', '[]'::jsonb);
  END IF;

  UPDATE public.trips
     SET is_active           = CASE WHEN v_completion THEN false ELSE is_active END,
         is_paused           = CASE WHEN v_completion THEN false ELSE is_paused END,
         active_tank_number  = CASE WHEN v_completion OR v_clear_tank THEN NULL ELSE active_tank_number END,
         is_filling_tank     = CASE WHEN v_completion OR v_clear_fill THEN false ELSE is_filling_tank END,
         filling_tank_number = CASE WHEN v_completion OR v_clear_fill THEN NULL ELSE filling_tank_number END,
         sync_version        = COALESCE(sync_version, 0) + 1,
         client_updated_at   = now(),
         updated_at          = now()
   WHERE id = p_trip_id
   RETURNING * INTO t_new;

  INSERT INTO public.audit_events (vineyard_id, user_id, action, entity_type, entity_id, details)
  VALUES (t_old.vineyard_id, auth.uid(), 'admin_reconcile_trip_runtime', 'trip', t_old.id,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'repairs', to_jsonb(v_repairs),
      'at', now(),
      'previous', jsonb_build_object('is_active', t_old.is_active, 'is_paused', t_old.is_paused,
        'active_tank_number', t_old.active_tank_number, 'is_filling_tank', t_old.is_filling_tank,
        'filling_tank_number', t_old.filling_tank_number, 'end_time', t_old.end_time,
        'sync_version', t_old.sync_version),
      'resulting', jsonb_build_object('is_active', t_new.is_active, 'is_paused', t_new.is_paused,
        'active_tank_number', t_new.active_tank_number, 'is_filling_tank', t_new.is_filling_tank,
        'filling_tank_number', t_new.filling_tank_number, 'end_time', t_new.end_time,
        'sync_version', t_new.sync_version)))
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object('status', 'repaired', 'trip_id', t_new.id, 'repairs', to_jsonb(v_repairs),
    'previous_active_tank_number', t_old.active_tank_number,
    'previous_filling_tank_number', t_old.filling_tank_number,
    'end_time', t_new.end_time, 'sync_version', t_new.sync_version, 'audit_event_id', v_audit_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reconcile_trip_runtime(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_trip_runtime(uuid, text) TO authenticated;

-- ---------- admin_close_spray_record_from_trip ----------

CREATE OR REPLACE FUNCTION public.admin_close_spray_record_from_trip(
  p_trip_id uuid,
  p_reason  text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t public.trips%ROWTYPE;
  v_sr_id uuid;
  v_sr_prev_end text;
  v_sr_prev_version integer;
  v_sr_type text;
  v_audit_id uuid;
BEGIN
  IF NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A support reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO t FROM public.trips WHERE id = p_trip_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'P0002';
  END IF;
  IF t.end_time IS NULL THEN
    RAISE EXCEPTION 'Trip has not finished; its Spray Record cannot be closed from it' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, end_time::text, sync_version INTO v_sr_id, v_sr_prev_end, v_sr_prev_version
    FROM public.spray_records
   WHERE trip_id = p_trip_id AND deleted_at IS NULL AND end_time IS NULL
   ORDER BY created_at DESC LIMIT 1
   FOR UPDATE;

  IF v_sr_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.spray_records WHERE trip_id = p_trip_id AND deleted_at IS NULL) THEN
      RETURN jsonb_build_object('status', 'already_closed', 'trip_id', t.id);
    END IF;
    RAISE EXCEPTION 'No linked Spray Record' USING ERRCODE = 'P0002';
  END IF;

  SELECT data_type INTO v_sr_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='spray_records' AND column_name='end_time';
  IF v_sr_type IN ('text', 'character varying') THEN
    UPDATE public.spray_records
       SET end_time = to_char(t.end_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           sync_version = COALESCE(sync_version, 0) + 1, updated_at = now()
     WHERE id = v_sr_id;
  ELSE
    EXECUTE 'UPDATE public.spray_records SET end_time = $1, sync_version = COALESCE(sync_version,0)+1, updated_at = now() WHERE id = $2'
      USING t.end_time, v_sr_id;
  END IF;

  INSERT INTO public.audit_events (vineyard_id, user_id, action, entity_type, entity_id, details)
  VALUES (t.vineyard_id, auth.uid(), 'admin_close_spray_record_from_trip', 'trip', t.id,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'at', now(),
      'spray_record_id', v_sr_id,
      'previous', jsonb_build_object('spray_record_end_time', v_sr_prev_end, 'sync_version', v_sr_prev_version),
      'resulting', jsonb_build_object('spray_record_end_time', t.end_time,
        'sync_version', COALESCE(v_sr_prev_version, 0) + 1)))
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object('status', 'closed', 'trip_id', t.id, 'spray_record_id', v_sr_id,
    'end_time', t.end_time, 'audit_event_id', v_audit_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_close_spray_record_from_trip(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_close_spray_record_from_trip(uuid, text) TO authenticated;

COMMIT;

-- Verification (after SQL 250 + 251):
-- 1. Non-admin: both RPCs fail 42501; empty reason fails 22023.
-- 2. Stale Tank 1 (session ended, active_tank_number = 1): reconcile returns
--    repairs ["tank"], end_time still NULL, is_active unchanged, tank_sessions
--    and spray_tank_actuals byte-identical. Second call -> 'nothing_to_repair'.
-- 3. Open Tank 1 session: reconcile raises P0001 and changes nothing.
-- 4. is_filling_tank with no open fill: repairs ["fill"]; with an open fill: untouched.
-- 5. end_time set + is_active true: repairs ["completion"], end_time unchanged.
-- 6. Completed Trip + open Spray Record: close -> spray end_time = trip end_time;
--    second call -> 'already_closed'. Active Trip -> P0001.
-- 7. Each real change writes exactly one audit_events row.
