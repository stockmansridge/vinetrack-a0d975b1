-- ============================================================================
-- SQL 257 — System Admin aggregate: platform action stats (read-only)
-- ============================================================================
-- Powers the System Admin → Dashboard "What people are doing" section.
-- One row per action (trips, pins, blocks, chemicals, …) with counts of
-- records created / edited / deleted inside the window, plus the number of
-- distinct vineyards (and users, where the table records a creator).
--
-- Platform-neutral: counts records whatever app made them (Portal, iOS,
-- Android). No device split.
--
-- Defensive: each table/column is checked in information_schema before it is
-- counted, so a table that does not exist (or lacks updated_at / deleted_at /
-- created_by) simply returns NULL for that metric instead of failing.
--
-- Purely additive. No table, policy, grant or existing function is changed.
-- Authorisation: SECURITY DEFINER + public.is_system_admin(), like other
-- admin_* RPCs. EXECUTE to authenticated only.
--
-- p_days: 1, 7, 30, 90 … ; NULL = all time.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_platform_action_stats(p_days integer DEFAULT 30)
RETURNS TABLE (
  action_key       text,
  label            text,
  category         text,
  created_count    bigint,
  edited_count     bigint,
  deleted_count    bigint,
  vineyard_count   bigint,
  user_count       bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_since timestamptz := CASE WHEN p_days IS NULL THEN '-infinity'::timestamptz
                              ELSE now() - make_interval(days => p_days) END;
  r record;
  v_has_created boolean; v_has_updated boolean; v_has_deleted boolean;
  v_has_vineyard boolean; v_user_col text;
  v_created bigint; v_edited bigint; v_deleted bigint; v_vy bigint; v_users bigint;
BEGIN
  IF NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('trips',              'Trips',                 'Operations'),
      ('pins',               'Pins',                  'Operations'),
      ('spray_records',      'Spray records',         'Spraying'),
      ('spray_jobs',         'Planned sprays',        'Spraying'),
      ('saved_chemicals',    'Chemicals',             'Spraying'),
      ('saved_spray_presets','Spray presets',         'Spraying'),
      ('work_tasks',         'Work tasks',            'Operations'),
      ('paddocks',           'Blocks',                'Setup'),
      ('vineyard_machines',  'Machines',              'Setup'),
      ('tractors',           'Tractors',              'Setup'),
      ('spray_equipment',    'Spray equipment',       'Setup'),
      ('saved_inputs',       'Inputs',                'Setup'),
      ('vineyard_members',   'Team members',          'Team'),
      ('damage_records',     'Damage records',        'Records'),
      ('picking_records',    'Picking records',       'Records'),
      ('fertiliser_records', 'Fertiliser records',    'Records'),
      ('pruning_entries',    'Pruning entries',       'Records'),
      ('maintenance_logs',   'Maintenance logs',      'Equipment'),
      ('fuel_purchases',     'Fuel purchases',        'Equipment'),
      ('tractor_fuel_logs',  'Tractor fuel logs',     'Equipment'),
      ('yield_estimation_sessions','Yield estimates', 'Records'),
      ('resistance_plans',   'Resistance plans',      'Spraying'),
      ('grape_allocations',  'Grape allocations',     'Records')
    ) AS t(tbl, lbl, cat)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN CONTINUE; END IF;

    SELECT bool_or(column_name = 'created_at'),
           bool_or(column_name = 'updated_at'),
           bool_or(column_name = 'deleted_at'),
           bool_or(column_name = 'vineyard_id')
      INTO v_has_created, v_has_updated, v_has_deleted, v_has_vineyard
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = r.tbl;

    SELECT c.column_name INTO v_user_col
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = r.tbl
       AND c.column_name IN ('created_by','user_id','created_by_user_id')
     ORDER BY array_position(ARRAY['created_by','created_by_user_id','user_id'], c.column_name)
     LIMIT 1;

    v_created := NULL; v_edited := NULL; v_deleted := NULL; v_vy := NULL; v_users := NULL;

    IF v_has_created THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE created_at >= $1', r.tbl)
        INTO v_created USING v_since;
      IF v_has_vineyard THEN
        EXECUTE format('SELECT count(DISTINCT vineyard_id) FROM public.%I WHERE created_at >= $1', r.tbl)
          INTO v_vy USING v_since;
      END IF;
      IF v_user_col IS NOT NULL THEN
        EXECUTE format('SELECT count(DISTINCT %I) FROM public.%I WHERE created_at >= $1', v_user_col, r.tbl)
          INTO v_users USING v_since;
      END IF;
    END IF;

    IF v_has_updated AND v_has_created THEN
      EXECUTE format(
        'SELECT count(*) FROM public.%I WHERE updated_at >= $1 AND updated_at > created_at + interval ''1 minute''',
        r.tbl) INTO v_edited USING v_since;
    END IF;

    IF v_has_deleted THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE deleted_at >= $1', r.tbl)
        INTO v_deleted USING v_since;
    END IF;

    action_key := r.tbl; label := r.lbl; category := r.cat;
    created_count := v_created; edited_count := v_edited; deleted_count := v_deleted;
    vineyard_count := v_vy; user_count := v_users;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_platform_action_stats(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_action_stats(integer) TO authenticated;

COMMIT;

-- Verify (as a System Admin):
--   select * from public.admin_platform_action_stats(30);
--   select * from public.admin_platform_action_stats(null);  -- all time
