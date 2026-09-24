-- ============================================================================
-- SQL 252 — Fixes for SQL 250/251 found on the live database
-- ============================================================================
-- 1. admin_reconcile_trip_runtime failed with 22P02 "malformed array literal:
--    \"tank\"": `text[] || 'tank'` parses the literal as an array. Now uses
--    array_append(v_repairs, 'tank'::text). Logic otherwise identical to 251.
-- 2. admin_get_trip failed with 22023 "cannot extract elements from a scalar"
--    when the linked Spray Record has no application_blocks (JSON null is not
--    SQL NULL, so COALESCE did not catch it). Now only expands real arrays.
-- 3. admin_get_trip block names: iOS stores block IDs upper-case while
--    paddocks.id::text is lower-case, so names resolved as null. Now matched
--    case-insensitively. Read-only change.
-- No data is modified. SQL 250/251 files are left as handed off.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_trip(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t  public.trips%ROWTYPE;
  sr jsonb;
  v_actuals jsonb := '[]'::jsonb;
  v_has_trip_col boolean;
  v_has_sr_col boolean;
BEGIN
  IF NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO t FROM public.trips WHERE id = p_trip_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT to_jsonb(s) - 'tanks' || jsonb_build_object(
           'tank_count', CASE WHEN jsonb_typeof(to_jsonb(s)->'tanks') = 'array'
                              THEN jsonb_array_length(to_jsonb(s)->'tanks') END,
           'application_block_ids', public._admin_application_block_ids(to_jsonb(s)->'application_blocks'))
    INTO sr
    FROM public.spray_records s
   WHERE s.trip_id = t.id AND s.deleted_at IS NULL
   ORDER BY s.created_at DESC LIMIT 1;

  IF to_regclass('public.spray_tank_actuals') IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
                    AND table_name='spray_tank_actuals' AND column_name='trip_id') INTO v_has_trip_col;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
                    AND table_name='spray_tank_actuals' AND column_name='spray_record_id') INTO v_has_sr_col;
    IF v_has_trip_col THEN
      EXECUTE 'SELECT COALESCE(jsonb_agg(to_jsonb(a)), ''[]''::jsonb) FROM public.spray_tank_actuals a WHERE a.trip_id = $1'
        INTO v_actuals USING t.id;
    ELSIF v_has_sr_col AND sr IS NOT NULL THEN
      EXECUTE 'SELECT COALESCE(jsonb_agg(to_jsonb(a)), ''[]''::jsonb) FROM public.spray_tank_actuals a WHERE a.spray_record_id = $1'
        INTO v_actuals USING (sr->>'id')::uuid;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'trip', to_jsonb(t) - 'path_points' || jsonb_build_object(
      'path_point_count', CASE WHEN jsonb_typeof(t.path_points)='array' THEN jsonb_array_length(t.path_points) ELSE 0 END,
      'first_path_point', CASE WHEN jsonb_typeof(t.path_points)='array' THEN t.path_points->0 END,
      'last_path_point',  CASE WHEN jsonb_typeof(t.path_points)='array' THEN t.path_points->-1 END,
      'completed_path_count', CASE WHEN jsonb_typeof(t.completed_paths)='array' THEN jsonb_array_length(t.completed_paths) ELSE 0 END,
      'skipped_path_count',   CASE WHEN jsonb_typeof(t.skipped_paths)='array' THEN jsonb_array_length(t.skipped_paths) ELSE 0 END),
    'vineyard', (SELECT jsonb_build_object('id', v.id, 'name', v.name) FROM public.vineyards v WHERE v.id = t.vineyard_id),
    'operator', (SELECT jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email)
                   FROM public.profiles p WHERE p.id = t.operator_user_id),
    'tractor', (SELECT jsonb_build_object('id', tr.id, 'name', tr.name) FROM public.tractors tr WHERE tr.id = t.tractor_id),
    'blocks', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'name', pd.name)), '[]'::jsonb)
                 FROM jsonb_array_elements_text(public._admin_trip_block_ids(t.paddock_ids)) b(id)
                 LEFT JOIN public.paddocks pd ON lower(pd.id::text) = lower(b.id)),
    'spray_record', sr,
    'application_blocks', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'name', pd.name)), '[]'::jsonb)
                 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(sr->'application_block_ids') = 'array' THEN sr->'application_block_ids' ELSE '[]'::jsonb END) b(id)
                 LEFT JOIN public.paddocks pd ON lower(pd.id::text) = lower(b.id)),
    'tank_actuals', v_actuals,
    'audit', (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC), '[]'::jsonb)
                FROM public.audit_events a
               WHERE a.entity_type = 'trip' AND a.entity_id::text = t.id::text)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_trip(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_trip(uuid) TO authenticated;

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
      v_repairs := array_append(v_repairs, 'completion'::text);
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
        v_repairs := array_append(v_repairs, 'tank'::text);
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
        v_repairs := array_append(v_repairs, 'fill'::text);
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

COMMIT;
