-- ============================================================================
-- SQL 209 — Atomic Tractor write (tractor + linked machine mirror)
-- ============================================================================
-- A logical tractor is two physical rows that must never drift:
--   public.tractors           — user-facing configuration
--   public.vineyard_machines  — machine_type = 'tractor',
--                               legacy_tractor_id = tractors.id
-- so trips / fuel logs / spray records can keep referencing machine_id.
--
-- Clients must not write these in two independent round trips: a failure in
-- between is exactly what produced the campesi orphan (SQL 208) and fuel-rate
-- drift. Both are written here, inside ONE transaction.
--
-- iOS / Android compatibility: purely additive. No existing table, column,
-- constraint, trigger or function is changed, and no function of these names
-- existed before, so nothing is overloaded. iOS may keep writing the tables
-- directly; when it adopts these functions it gets the same guarantees.
--
-- Authorisation: SECURITY DEFINER, but every call re-checks vineyard
-- membership with an owner/manager role using auth.uid() — the same rule the
-- underlying RLS policies enforce. EXECUTE is granted to `authenticated` only.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.portal_upsert_tractor(
  p_tractor_id            uuid,
  p_vineyard_id           uuid,
  p_name                  text,
  p_brand                 text,
  p_model                 text,
  p_model_year            integer,
  p_fuel_usage_l_per_hour numeric,
  p_serial_number         text,
  p_vin_number            text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_tractor_id uuid := p_tractor_id;
  v_machine_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vineyard_members vm
     WHERE vm.vineyard_id = p_vineyard_id
       AND vm.user_id = v_uid
       AND vm.role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Not authorised to manage tractors for this vineyard'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Tractor name is required' USING ERRCODE = '22023';
  END IF;

  -- Fuel usage is OPTIONAL. NULL or 0 is stored as given; no rate is invented.
  IF p_fuel_usage_l_per_hour IS NOT NULL
     AND (p_fuel_usage_l_per_hour < 0 OR p_fuel_usage_l_per_hour > 1000) THEN
    RAISE EXCEPTION 'Fuel usage must be between 0 and 1000 L/hr' USING ERRCODE = '22023';
  END IF;

  IF v_tractor_id IS NULL THEN
    v_tractor_id := gen_random_uuid();
    INSERT INTO public.tractors (
      id, vineyard_id, name, brand, model, model_year,
      fuel_usage_l_per_hour, serial_number, vin_number,
      created_by, updated_by
    ) VALUES (
      v_tractor_id, p_vineyard_id, btrim(p_name), p_brand, p_model, p_model_year,
      p_fuel_usage_l_per_hour, p_serial_number, p_vin_number,
      v_uid, v_uid
    );
  ELSE
    UPDATE public.tractors
       SET name                  = btrim(p_name),
           brand                 = p_brand,
           model                 = p_model,
           model_year            = p_model_year,
           fuel_usage_l_per_hour = p_fuel_usage_l_per_hour,
           serial_number         = p_serial_number,
           vin_number            = p_vin_number,
           updated_by            = v_uid,
           updated_at            = now()
     WHERE id = v_tractor_id
       AND vineyard_id = p_vineyard_id
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Tractor % not found for this vineyard', v_tractor_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- Linked machine mirror — created on first save, kept in step afterwards.
  SELECT id INTO v_machine_id
    FROM public.vineyard_machines
   WHERE legacy_tractor_id = v_tractor_id
   LIMIT 1;

  IF v_machine_id IS NULL THEN
    v_machine_id := gen_random_uuid();
    INSERT INTO public.vineyard_machines (
      id, vineyard_id, legacy_tractor_id, machine_type, name, brand, model,
      model_year, fuel_usage_l_per_hour, serial_number, vin_number,
      created_by, updated_by
    ) VALUES (
      v_machine_id, p_vineyard_id, v_tractor_id, 'tractor', btrim(p_name),
      p_brand, p_model, p_model_year, p_fuel_usage_l_per_hour,
      p_serial_number, p_vin_number, v_uid, v_uid
    );
  ELSE
    UPDATE public.vineyard_machines
       SET name                  = btrim(p_name),
           machine_type          = 'tractor',
           brand                 = p_brand,
           model                 = p_model,
           model_year            = p_model_year,
           fuel_usage_l_per_hour = p_fuel_usage_l_per_hour,
           serial_number         = p_serial_number,
           vin_number            = p_vin_number,
           deleted_at            = NULL,
           updated_by            = v_uid,
           updated_at            = now()
     WHERE id = v_machine_id;
  END IF;

  RETURN jsonb_build_object('tractor_id', v_tractor_id, 'machine_id', v_machine_id);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_upsert_tractor(
  uuid, uuid, text, text, text, integer, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_upsert_tractor(
  uuid, uuid, text, text, text, integer, numeric, text, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.portal_archive_tractor(p_tractor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_vineyard_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT vineyard_id INTO v_vineyard_id FROM public.tractors WHERE id = p_tractor_id;
  IF v_vineyard_id IS NULL THEN
    RAISE EXCEPTION 'Tractor not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vineyard_members vm
     WHERE vm.vineyard_id = v_vineyard_id
       AND vm.user_id = v_uid
       AND vm.role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Not authorised to archive tractors for this vineyard'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.tractors
     SET deleted_at = now(), updated_by = v_uid, updated_at = now()
   WHERE id = p_tractor_id AND deleted_at IS NULL;

  -- The mirror is archived with it; historical trips and fuel logs keep their
  -- machine_id and are never modified.
  UPDATE public.vineyard_machines
     SET deleted_at = now(), updated_by = v_uid, updated_at = now()
   WHERE legacy_tractor_id = p_tractor_id AND deleted_at IS NULL;

  RETURN jsonb_build_object('tractor_id', p_tractor_id, 'archived', true);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_archive_tractor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_archive_tractor(uuid) TO authenticated;

COMMIT;
