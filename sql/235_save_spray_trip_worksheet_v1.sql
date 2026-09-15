-- 235: one transactional Spray Trip worksheet amendment.
--
-- Why: the Portal worksheet edits trip metadata and one or more tank actuals in
-- a single Save. Issuing the existing corrections as separate requests can
-- commit half the worksheet. This wrapper runs them inside ONE PostgreSQL
-- transaction so all requested changes commit, or none do.
--
-- It deliberately adds NO new validation, NO new tables and NO second
-- representation of actual water or chemicals. All rules stay where they are:
--   * public.correct_spray_trip_metadata_v1  (SQL 228)
--   * public.correct_spray_tank_actual_v1    (SQL 227)
-- Identity, correction_version optimistic concurrency, planned/saved chemical
-- identity, amendment history, editor identity and vineyard authorisation are
-- all enforced by those functions, unchanged.
--
-- SECURITY INVOKER on purpose: the call runs as the authenticated user, so the
-- existing RLS and vineyard-role checks inside the two functions still apply.
-- No new SECURITY DEFINER surface, no elevated execution.
--
-- Conflict signalling: the inner functions raise SQLSTATE 40001. 40001 can be
-- retried automatically by the stack, which is wrong for an amendment, so this
-- wrapper translates it into PT409 (PostgREST -> HTTP 409) and never leaks
-- 40001 to the client. (The existing 40001 usage inside
-- correct_spray_tank_actual_v1 is left untouched here — see the handoff note.)
--
-- Payload shape (camelCase JSON built by the Portal):
--   p_metadata: null, or
--     { "operationId": uuid, "expectedVersion": int, "machineId": uuid|null,
--       "tractorId": uuid|null, "sprayEquipmentId": uuid|null,
--       "operatorUserId": uuid|null, "fuelConsumptionLPerHour": number|null,
--       "startEngineHours": number|null, "endEngineHours": number|null }
--   p_tanks: [ { "operationId": uuid, "actualId": uuid,
--       "sprayRecordId": uuid|null, "tankSessionId": text|null,
--       "tankNumber": int, "expectedVersion": int,
--       "waterVolumeL": number|null, "chemicals": [...] } ]
-- Each tank keeps its OWN stable correction operation id.

CREATE OR REPLACE FUNCTION public.save_spray_trip_worksheet_v1(
  p_operation_id uuid,
  p_trip_id uuid,
  p_metadata jsonb DEFAULT NULL,
  p_tanks jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb := NULL;
  v_tank jsonb;
  v_tanks jsonb := COALESCE(p_tanks, '[]'::jsonb);
  v_seen uuid[] := '{}';
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'A worksheet save operation id is required' USING ERRCODE = 'PT400';
  END IF;
  IF p_trip_id IS NULL THEN
    RAISE EXCEPTION 'A trip id is required' USING ERRCODE = 'PT400';
  END IF;
  IF jsonb_typeof(v_tanks) <> 'array' THEN
    RAISE EXCEPTION 'Tank corrections must be an array' USING ERRCODE = 'PT400';
  END IF;
  IF p_metadata IS NULL AND jsonb_array_length(v_tanks) = 0 THEN
    RAISE EXCEPTION 'Nothing to save' USING ERRCODE = 'PT400';
  END IF;

  -- Reject a malformed request before any mutation: every tank needs its own
  -- stable correction operation id.
  FOR v_tank IN SELECT * FROM jsonb_array_elements(v_tanks) LOOP
    IF (v_tank->>'operationId') IS NULL OR (v_tank->>'actualId') IS NULL
       OR (v_tank->>'tankNumber') IS NULL THEN
      RAISE EXCEPTION 'Each tank correction needs an operation id, actual id and tank number'
        USING ERRCODE = 'PT400';
    END IF;
    IF (v_tank->>'operationId')::uuid = ANY (v_seen) THEN
      RAISE EXCEPTION 'Each tank correction must have its own operation id'
        USING ERRCODE = 'PT400';
    END IF;
    v_seen := v_seen || ((v_tank->>'operationId')::uuid);
  END LOOP;

  BEGIN
    IF p_metadata IS NOT NULL THEN
      SELECT public.correct_spray_trip_metadata_v1(
        p_operation_id := (p_metadata->>'operationId')::uuid,
        p_trip_id := p_trip_id,
        p_expected_version := (p_metadata->>'expectedVersion')::bigint,
        p_machine_id := (p_metadata->>'machineId')::uuid,
        p_tractor_id := (p_metadata->>'tractorId')::uuid,
        p_spray_equipment_id := (p_metadata->>'sprayEquipmentId')::uuid,
        p_operator_user_id := (p_metadata->>'operatorUserId')::uuid,
        p_fuel_consumption_l_per_hour := (p_metadata->>'fuelConsumptionLPerHour')::double precision,
        p_start_engine_hours := (p_metadata->>'startEngineHours')::double precision,
        p_end_engine_hours := (p_metadata->>'endEngineHours')::double precision
      ) INTO v_meta;
    END IF;

    FOR v_tank IN SELECT * FROM jsonb_array_elements(v_tanks) LOOP
      PERFORM public.correct_spray_tank_actual_v1(
        p_operation_id := (v_tank->>'operationId')::uuid,
        p_actual_id := (v_tank->>'actualId')::uuid,
        p_trip_id := p_trip_id,
        p_spray_record_id := (v_tank->>'sprayRecordId')::uuid,
        p_tank_session_id := v_tank->>'tankSessionId',
        p_tank_number := (v_tank->>'tankNumber')::integer,
        p_expected_version := (v_tank->>'expectedVersion')::bigint,
        p_water_volume_l := (v_tank->>'waterVolumeL')::double precision,
        p_chemicals := COALESCE(v_tank->'chemicals', '[]'::jsonb)
      );
    END LOOP;
  EXCEPTION WHEN SQLSTATE '40001' THEN
    -- Optimistic-concurrency refusal from either inner correction. Nothing in
    -- this call has committed.
    RAISE EXCEPTION
      'WORKSHEET_VERSION_CONFLICT: this trip was changed by someone else while you were editing.'
      USING ERRCODE = 'PT409';
  END;

  RETURN jsonb_build_object(
    'operationId', p_operation_id,
    'metadata', v_meta,
    'tankCount', jsonb_array_length(v_tanks)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_spray_trip_worksheet_v1(uuid, uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_spray_trip_worksheet_v1(uuid, uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_spray_trip_worksheet_v1(uuid, uuid, jsonb, jsonb) TO authenticated;

COMMENT ON FUNCTION public.save_spray_trip_worksheet_v1(uuid, uuid, jsonb, jsonb) IS
  'Portal worksheet amendment: runs correct_spray_trip_metadata_v1 and correct_spray_tank_actual_v1 for one frozen Save attempt inside a single transaction. Adds no validation of its own and never touches trip is_active, end_time, tank sessions or Spray Record planned values.';
