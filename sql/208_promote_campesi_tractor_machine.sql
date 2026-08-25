-- ============================================================================
-- SQL 208 — Promote the campesi orphan tractor-machine to a proper Tractor
-- ============================================================================
-- Target row (integrity check C9):
--   vineyard_machines.id = '1fd13cc9-7fee-42d1-8ff6-e8179a5e10a7'
--   vineyard            : campesi
--   name                : Kubota M092-N
--   machine_type        : 'tractor'
--   legacy_tractor_id   : NULL   <-- the defect
--
-- Pre-flight audit (already performed, read-only, production):
--   * 0 rows in trips              reference this machine_id
--   * 0 rows in tractor_fuel_logs  reference this machine_id
--   * 0 rows in spray_records      reference this machine_id
--   * machine_id is exposed by exactly 3 tables: vineyard_machines, trips,
--     tractor_fuel_logs
--   * vineyard campesi has 0 rows in public.tractors
--
-- Strategy: PRESERVE THE MACHINE ID. The machine row keeps its id (so any
-- reference created between the audit and this migration stays valid) and is
-- linked to a NEW tractors row via legacy_tractor_id. Nothing is deleted and
-- no history is rewritten.
--
-- Idempotent and self-verifying: re-running it is a no-op, and it aborts if
-- the preconditions no longer hold.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_machine_id  uuid := '1fd13cc9-7fee-42d1-8ff6-e8179a5e10a7';
  v_machine     public.vineyard_machines%ROWTYPE;
  v_tractor_id  uuid;
  v_refs        integer;
BEGIN
  SELECT * INTO v_machine
    FROM public.vineyard_machines
   WHERE id = v_machine_id;

  IF NOT FOUND THEN
    RAISE NOTICE 'SQL 208: machine % not found — nothing to do.', v_machine_id;
    RETURN;
  END IF;

  IF v_machine.legacy_tractor_id IS NOT NULL THEN
    RAISE NOTICE 'SQL 208: machine % already linked to tractor % — no-op.',
      v_machine_id, v_machine.legacy_tractor_id;
    RETURN;
  END IF;

  IF v_machine.machine_type IS DISTINCT FROM 'tractor' THEN
    RAISE EXCEPTION 'SQL 208 aborted: machine % is machine_type %, not tractor.',
      v_machine_id, v_machine.machine_type;
  END IF;

  -- Re-verify the reference audit at execution time. Promotion preserves the
  -- machine id, so references are safe either way; this is a tripwire that the
  -- row is still the one that was audited.
  SELECT (SELECT count(*) FROM public.trips WHERE machine_id = v_machine_id)
       + (SELECT count(*) FROM public.tractor_fuel_logs WHERE machine_id = v_machine_id)
    INTO v_refs;
  RAISE NOTICE 'SQL 208: % existing trip/fuel references (preserved, id unchanged).', v_refs;

  -- 1) Create the tractor record the machine should always have had.
  v_tractor_id := gen_random_uuid();
  INSERT INTO public.tractors (
    id, vineyard_id, name, brand, model, model_year,
    fuel_usage_l_per_hour, serial_number, vin_number,
    created_by, updated_by, created_at, updated_at
  ) VALUES (
    v_tractor_id,
    v_machine.vineyard_id,
    v_machine.name,
    v_machine.brand,
    v_machine.model,
    v_machine.model_year,
    -- Carry the machine's rate across verbatim. NULL/0 stays NULL/0:
    -- no fuel rate is invented during promotion.
    v_machine.fuel_usage_l_per_hour,
    v_machine.serial_number,
    v_machine.vin_number,
    v_machine.created_by,
    v_machine.updated_by,
    COALESCE(v_machine.created_at, now()),
    now()
  );

  -- 2) Link the existing machine row as the tractor's internal representation.
  --    Its id is untouched, so every existing reference keeps resolving.
  UPDATE public.vineyard_machines
     SET legacy_tractor_id = v_tractor_id,
         updated_at        = now()
   WHERE id = v_machine_id;

  RAISE NOTICE 'SQL 208: promoted machine % to tractor %.', v_machine_id, v_tractor_id;
END $$;

COMMIT;
