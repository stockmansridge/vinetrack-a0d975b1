-- ============================================================================
-- SQL 250 — System Admin Trip support + recovery, generic completed-Trip lock
-- ============================================================================
-- Adds:
--   admin_list_trips(p_vineyard_id, p_from, p_to, p_limit)       -> SETOF jsonb rows
--   admin_get_trip(p_trip_id)                                     -> jsonb
--   admin_force_stop_trip(p_trip_id, p_reason, p_end_time)        -> jsonb
--   trigger zz_trips_completed_invariant (BEFORE UPDATE on trips)
--
-- Authorisation: same pattern as SQL 210–212 / 240 (SECURITY DEFINER +
-- explicit public.is_system_admin(); EXECUTE for authenticated only).
--
-- Never deletes or fabricates operational data. Force Stop only closes the
-- runtime lifecycle fields; path_points, total_distance, tank_sessions,
-- completed/skipped paths, pins, weather, spray_tank_actuals, chemicals,
-- planned tanks and application_blocks are left untouched.
--
-- LEGACY SAFEGUARD: the temporary Estellar-specific trigger that keeps a
-- hardcoded list of completed Trips closed is NOT in the Portal repository.
-- The generic trigger below enforces the same invariant for every Trip and
-- is named so it fires LAST among BEFORE UPDATE triggers (alphabetical
-- order), so it has the final word and cannot compete. After verifying this
-- migration, drop the legacy customer-specific trigger (the DO block at the
-- end lists every trigger on public.trips to help identify it).
-- ============================================================================

BEGIN;

-- ---------- generic completed-Trip invariant ----------

CREATE OR REPLACE FUNCTION public.trips_enforce_completed_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Once a Trip has a persisted completion end_time, no update (e.g. a stale
  -- offline snapshot) may turn it back into a running Trip. Legitimate edits
  -- to historical metadata still apply, but runtime state stays closed.
  IF OLD.end_time IS NOT NULL THEN
    IF NEW.end_time IS NULL THEN
      NEW.end_time := OLD.end_time;
    END IF;
    NEW.is_active           := false;
    NEW.is_paused           := false;
    NEW.active_tank_number  := NULL;
    NEW.is_filling_tank     := false;
    NEW.filling_tank_number := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_trips_completed_invariant ON public.trips;
CREATE TRIGGER zz_trips_completed_invariant
  BEFORE UPDATE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.trips_enforce_completed_invariant();

-- ---------- helpers ----------

CREATE OR REPLACE FUNCTION public._admin_trip_block_ids(p jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p) = 'array'
    THEN COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements_text(p) v), '[]'::jsonb)
    ELSE '[]'::jsonb END
$$;

CREATE OR REPLACE FUNCTION public._admin_application_block_ids(p jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p) = 'array'
    THEN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT COALESCE(e->>'blockId', e->>'block_id', e->>'paddockId', e->>'paddock_id') AS x
        FROM jsonb_array_elements(p) e WHERE jsonb_typeof(e) = 'object') s WHERE x IS NOT NULL), '[]'::jsonb)
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public._admin_tank_session_summary(p jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p) = 'array'
    THEN COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'tankNumber', COALESCE(e->'tankNumber', e->'tank_number', e->'number'),
        'startTime',  COALESCE(e->'startTime', e->'start_time'),
        'endTime',    COALESCE(e->'endTime', e->'end_time'),
        'fillStartTime', COALESCE(e->'fillStartTime', e->'fill_start_time'),
        'fillEndTime',   COALESCE(e->'fillEndTime', e->'fill_end_time'),
        'id', COALESCE(e->'id', e->'tankSessionId'))) FROM jsonb_array_elements(p) e), '[]'::jsonb)
    ELSE '[]'::jsonb END
$$;

REVOKE ALL ON FUNCTION public._admin_trip_block_ids(jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public._admin_application_block_ids(jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public._admin_tank_session_summary(jsonb) FROM public, anon;

-- ---------- admin_list_trips ----------

CREATE OR REPLACE FUNCTION public.admin_list_trips(
  p_vineyard_id uuid        DEFAULT NULL,
  p_from        timestamptz DEFAULT NULL,
  p_to          timestamptz DEFAULT NULL,
  p_limit       integer     DEFAULT 500
)
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', t.id,
    'vineyard_id', t.vineyard_id,
    'vineyard_name', v.name,
    'operator_user_id', t.operator_user_id,
    'operator_name', COALESCE(NULLIF(t.person_name, ''), op.full_name),
    'operator_email', op.email,
    'trip_title', t.trip_title,
    'trip_function', t.trip_function,
    'tracking_pattern', t.tracking_pattern,
    'start_time', t.start_time,
    'end_time', t.end_time,
    'is_active', t.is_active,
    'is_paused', t.is_paused,
    'total_distance', t.total_distance,
    'total_tanks', t.total_tanks,
    'active_tank_number', t.active_tank_number,
    'is_filling_tank', t.is_filling_tank,
    'filling_tank_number', t.filling_tank_number,
    'block_ids', public._admin_trip_block_ids(t.paddock_ids),
    'tank_sessions', public._admin_tank_session_summary(t.tank_sessions),
    'sync_version', t.sync_version,
    'client_updated_at', t.client_updated_at,
    'created_at', t.created_at,
    'updated_at', t.updated_at,
    'spray_record_id', sr.id,
    'spray_record_end_time', sr.end_time,
    'spray_record_start_time', sr.start_time,
    'spray_application_block_ids', public._admin_application_block_ids(to_jsonb(sr)->'application_blocks')
  )
  FROM public.trips t
  LEFT JOIN public.vineyards v ON v.id = t.vineyard_id
  LEFT JOIN public.profiles op ON op.id = t.operator_user_id
  LEFT JOIN LATERAL (
    SELECT s.* FROM public.spray_records s
     WHERE s.trip_id = t.id AND s.deleted_at IS NULL
     ORDER BY s.created_at DESC LIMIT 1
  ) sr ON true
  WHERE t.deleted_at IS NULL
    AND (p_vineyard_id IS NULL OR t.vineyard_id = p_vineyard_id)
    AND (p_from IS NULL OR t.start_time >= p_from OR t.is_active)
    AND (p_to   IS NULL OR t.start_time <= p_to   OR t.is_active)
  ORDER BY t.is_active DESC NULLS LAST, COALESCE(t.start_time, t.created_at) DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_trips(uuid, timestamptz, timestamptz, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_trips(uuid, timestamptz, timestamptz, integer) TO authenticated;

-- ---------- admin_get_trip ----------

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
                 LEFT JOIN public.paddocks pd ON pd.id::text = b.id),
    'spray_record', sr,
    'application_blocks', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'name', pd.name)), '[]'::jsonb)
                 FROM jsonb_array_elements_text(COALESCE(sr->'application_block_ids', '[]'::jsonb)) b(id)
                 LEFT JOIN public.paddocks pd ON pd.id::text = b.id),
    'tank_actuals', v_actuals,
    'audit', (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC), '[]'::jsonb)
                FROM public.audit_events a
               WHERE a.entity_type = 'trip' AND a.entity_id::text = t.id::text)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_trip(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_trip(uuid) TO authenticated;

-- ---------- admin_force_stop_trip ----------

CREATE OR REPLACE FUNCTION public.admin_force_stop_trip(
  p_trip_id  uuid,
  p_reason   text,
  p_end_time timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t_old public.trips%ROWTYPE;
  t_new public.trips%ROWTYPE;
  v_stop timestamptz;
  v_sr_id uuid;
  v_sr_closed boolean := false;
  v_sr_type text;
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

  -- Idempotent: already fully closed -> no change, no new audit event.
  IF t_old.end_time IS NOT NULL
     AND COALESCE(t_old.is_active, false) = false
     AND COALESCE(t_old.is_paused, false) = false
     AND t_old.active_tank_number IS NULL
     AND COALESCE(t_old.is_filling_tank, false) = false
     AND t_old.filling_tank_number IS NULL THEN
    RETURN jsonb_build_object('status', 'already_completed', 'trip_id', t_old.id, 'end_time', t_old.end_time);
  END IF;

  -- An existing persisted end_time wins, so completion stays consistent.
  IF t_old.end_time IS NOT NULL THEN
    v_stop := t_old.end_time;
  ELSE
    IF p_end_time IS NULL THEN
      RAISE EXCEPTION 'A completion time is required' USING ERRCODE = '22023';
    END IF;
    IF t_old.start_time IS NOT NULL AND p_end_time < t_old.start_time THEN
      RAISE EXCEPTION 'Completion time cannot be before the Trip start' USING ERRCODE = '22023';
    END IF;
    IF p_end_time > now() + interval '5 minutes' THEN
      RAISE EXCEPTION 'Completion time cannot be in the future' USING ERRCODE = '22023';
    END IF;
    v_stop := p_end_time;
  END IF;

  UPDATE public.trips
     SET end_time            = v_stop,
         is_active           = false,
         is_paused           = false,
         active_tank_number  = NULL,
         is_filling_tank     = false,
         filling_tank_number = NULL,
         sync_version        = COALESCE(sync_version, 0) + 1,
         client_updated_at   = now(),
         updated_at          = now()
   WHERE id = p_trip_id
   RETURNING * INTO t_new;

  -- Close a linked, still-open Spray Record at the same completion time.
  SELECT id INTO v_sr_id FROM public.spray_records
   WHERE trip_id = p_trip_id AND deleted_at IS NULL AND end_time IS NULL
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v_sr_id IS NOT NULL THEN
    SELECT data_type INTO v_sr_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name='spray_records' AND column_name='end_time';
    IF v_sr_type IN ('text', 'character varying') THEN
      UPDATE public.spray_records
         SET end_time = to_char(v_stop AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             sync_version = COALESCE(sync_version, 0) + 1, updated_at = now()
       WHERE id = v_sr_id;
    ELSE
      EXECUTE 'UPDATE public.spray_records SET end_time = $1, sync_version = COALESCE(sync_version,0)+1, updated_at = now() WHERE id = $2'
        USING v_stop, v_sr_id;
    END IF;
    v_sr_closed := true;
  END IF;

  INSERT INTO public.audit_events (vineyard_id, user_id, action, entity_type, entity_id, details)
  VALUES (t_old.vineyard_id, auth.uid(), 'admin_force_stop_trip', 'trip', t_old.id,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'chosen_end_time', v_stop,
      'requested_end_time', p_end_time,
      'spray_record_id', v_sr_id,
      'spray_record_closed', v_sr_closed,
      'previous', jsonb_build_object('end_time', t_old.end_time, 'is_active', t_old.is_active,
        'is_paused', t_old.is_paused, 'active_tank_number', t_old.active_tank_number,
        'is_filling_tank', t_old.is_filling_tank, 'filling_tank_number', t_old.filling_tank_number,
        'sync_version', t_old.sync_version),
      'resulting', jsonb_build_object('end_time', t_new.end_time, 'is_active', t_new.is_active,
        'is_paused', t_new.is_paused, 'active_tank_number', t_new.active_tank_number,
        'is_filling_tank', t_new.is_filling_tank, 'filling_tank_number', t_new.filling_tank_number,
        'sync_version', t_new.sync_version)))
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object('status', 'stopped', 'trip_id', t_new.id, 'end_time', t_new.end_time,
    'sync_version', t_new.sync_version, 'spray_record_closed', v_sr_closed, 'audit_event_id', v_audit_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_force_stop_trip(uuid, text, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_force_stop_trip(uuid, text, timestamptz) TO authenticated;

COMMIT;

-- Identify the legacy Estellar-specific trigger for removal.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger
            WHERE tgrelid = 'public.trips'::regclass AND NOT tgisinternal LOOP
    RAISE NOTICE 'trips trigger: % -> %', r.tgname, r.def;
  END LOOP;
END $$;

-- Verification
-- 1. Non-admin: all three RPCs fail with 42501.
-- 2. admin_force_stop_trip(id, '', now()) fails 22023 (reason required).
-- 3. Force stop an active Trip twice: first returns status 'stopped' + audit
--    event; second returns 'already_completed' and writes nothing.
-- 4. Stale client: UPDATE trips SET is_active = true, end_time = NULL,
--    active_tank_number = 1 WHERE id = <completed trip>; the row stays
--    completed with the original end_time and no active tank.
-- 5. path_points / tank_sessions / total_distance / spray_tank_actuals are
--    byte-identical before and after force stop.
