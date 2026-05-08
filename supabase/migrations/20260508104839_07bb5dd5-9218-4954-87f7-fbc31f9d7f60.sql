-- Restore RPC for saved_chemicals (mirror of soft_delete_saved_chemicals).
CREATE OR REPLACE FUNCTION public.restore_saved_chemicals(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vineyard_id uuid;
BEGIN
  SELECT vineyard_id INTO v_vineyard_id
  FROM public.saved_chemicals
  WHERE id = p_id;

  IF v_vineyard_id IS NULL THEN
    RAISE EXCEPTION 'Chemical not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vineyard_members vm
    WHERE vm.vineyard_id = v_vineyard_id
      AND vm.user_id = auth.uid()
      AND vm.role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Not authorised to restore this chemical' USING ERRCODE = '42501';
  END IF;

  UPDATE public.saved_chemicals
  SET deleted_at = NULL,
      updated_at = now()
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_saved_chemicals(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.restore_saved_chemicals(uuid) TO authenticated;