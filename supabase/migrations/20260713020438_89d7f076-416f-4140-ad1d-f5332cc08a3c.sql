
-- ============ satellite_paddock_manifest ============
CREATE TABLE IF NOT EXISTS public.satellite_paddock_manifest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vineyard_id uuid NOT NULL,
  paddock_id uuid NOT NULL,
  latest_display_scene_id uuid,
  latest_display_acquired_at timestamptz,
  latest_complete_scene_id uuid,
  latest_complete_acquired_at timestamptz,
  latest_processing_version text,
  available_layer_types text[] NOT NULL DEFAULT '{}',
  available_analytical_types text[] NOT NULL DEFAULT '{}',
  missing_display_count int NOT NULL DEFAULT 0,
  missing_analytical_count int NOT NULL DEFAULT 0,
  missing_summary_count int NOT NULL DEFAULT 0,
  package_status text NOT NULL DEFAULT 'no_imagery'
    CHECK (package_status IN ('no_imagery','display_available','partial','upgrade_required','complete')),
  last_provider_check_at timestamptz,
  last_successful_refresh_at timestamptz,
  last_asset_repair_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vineyard_id, paddock_id)
);
CREATE INDEX IF NOT EXISTS satellite_paddock_manifest_vineyard_idx
  ON public.satellite_paddock_manifest (vineyard_id);

GRANT SELECT ON public.satellite_paddock_manifest TO authenticated;
GRANT ALL ON public.satellite_paddock_manifest TO service_role;
ALTER TABLE public.satellite_paddock_manifest ENABLE ROW LEVEL SECURITY;
-- Admin-only surface via service_role in edge functions; no direct client access.
CREATE POLICY "manifest_service_role_all"
  ON public.satellite_paddock_manifest FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER satellite_paddock_manifest_set_updated_at
  BEFORE UPDATE ON public.satellite_paddock_manifest
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ satellite_refresh_jobs ============
CREATE TABLE IF NOT EXISTS public.satellite_refresh_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vineyard_id uuid NOT NULL,
  job_type text NOT NULL
    CHECK (job_type IN ('provider_refresh','asset_repair','historical_backfill')),
  requested_by uuid,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','complete','partial','failed','cancelled','expired')),
  started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  expiry_at timestamptz,
  current_paddock_id uuid,
  total_paddocks int NOT NULL DEFAULT 0,
  completed_paddocks int NOT NULL DEFAULT 0,
  failed_paddocks int NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- At most one active (queued|running) job per (vineyard, job_type).
CREATE UNIQUE INDEX IF NOT EXISTS satellite_refresh_jobs_active_uidx
  ON public.satellite_refresh_jobs (vineyard_id, job_type)
  WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS satellite_refresh_jobs_vineyard_created_idx
  ON public.satellite_refresh_jobs (vineyard_id, created_at DESC);

GRANT SELECT ON public.satellite_refresh_jobs TO authenticated;
GRANT ALL ON public.satellite_refresh_jobs TO service_role;
ALTER TABLE public.satellite_refresh_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "refresh_jobs_service_role_all"
  ON public.satellite_refresh_jobs FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER satellite_refresh_jobs_set_updated_at
  BEFORE UPDATE ON public.satellite_refresh_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Refresh job helpers ============
-- Expire jobs whose heartbeat is stale or explicit expiry has passed.
CREATE OR REPLACE FUNCTION public.expire_stale_refresh_jobs()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  UPDATE public.satellite_refresh_jobs
     SET status = 'expired', completed_at = now()
   WHERE status IN ('queued','running')
     AND (
       (heartbeat_at IS NOT NULL AND heartbeat_at < now() - interval '3 minutes')
       OR (expiry_at IS NOT NULL AND expiry_at < now())
       OR (heartbeat_at IS NULL AND started_at IS NOT NULL AND started_at < now() - interval '3 minutes')
     );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_stale_refresh_jobs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_refresh_jobs() TO service_role;

-- Claim a new job, returning row or NULL if one is already active.
CREATE OR REPLACE FUNCTION public.claim_refresh_job(
  p_vineyard_id uuid,
  p_job_type text,
  p_requested_by uuid,
  p_total_paddocks int
) RETURNS public.satellite_refresh_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE row public.satellite_refresh_jobs;
BEGIN
  PERFORM public.expire_stale_refresh_jobs();
  BEGIN
    INSERT INTO public.satellite_refresh_jobs
      (vineyard_id, job_type, requested_by, status, started_at, heartbeat_at, expiry_at, total_paddocks)
    VALUES
      (p_vineyard_id, p_job_type, p_requested_by, 'running', now(), now(),
       now() + interval '10 minutes', COALESCE(p_total_paddocks, 0))
    RETURNING * INTO row;
  EXCEPTION WHEN unique_violation THEN
    RETURN NULL;
  END;
  RETURN row;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_refresh_job(uuid,text,uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_refresh_job(uuid,text,uuid,int) TO service_role;

-- Heartbeat + progress update.
CREATE OR REPLACE FUNCTION public.heartbeat_refresh_job(
  p_job_id uuid,
  p_current_paddock_id uuid,
  p_completed_paddocks int,
  p_failed_paddocks int
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.satellite_refresh_jobs
     SET heartbeat_at = now(),
         expiry_at = now() + interval '10 minutes',
         current_paddock_id = COALESCE(p_current_paddock_id, current_paddock_id),
         completed_paddocks = COALESCE(p_completed_paddocks, completed_paddocks),
         failed_paddocks = COALESCE(p_failed_paddocks, failed_paddocks)
   WHERE id = p_job_id AND status = 'running';
END;
$$;
REVOKE ALL ON FUNCTION public.heartbeat_refresh_job(uuid,uuid,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.heartbeat_refresh_job(uuid,uuid,int,int) TO service_role;

-- Finish job with terminal status.
CREATE OR REPLACE FUNCTION public.finish_refresh_job(
  p_job_id uuid,
  p_status text,
  p_error text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('complete','partial','failed','cancelled') THEN
    RAISE EXCEPTION 'Invalid terminal status %', p_status;
  END IF;
  UPDATE public.satellite_refresh_jobs
     SET status = p_status,
         completed_at = now(),
         heartbeat_at = now(),
         error = p_error
   WHERE id = p_job_id;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_refresh_job(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finish_refresh_job(uuid,text,text) TO service_role;

-- ============ Manifest recomputation ============
CREATE OR REPLACE FUNCTION public.refresh_paddock_manifest(p_paddock_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vineyard_id uuid;
  v_current_version text := 'sentinel2-v3-eleven-layers';
  v_latest_display_scene_id uuid;
  v_latest_display_acquired_at timestamptz;
  v_latest_complete_scene_id uuid;
  v_latest_complete_acquired_at timestamptz;
  v_display_types text[] := '{}';
  v_analytical_types text[] := '{}';
  v_required_indices constant text[] :=
    ARRAY['TRUE_COLOUR','NDVI','EVI','GNDVI','MSAVI','NDRE','RECI','GCI','RENDVI','NDMI','PSRI'];
  v_numeric_indices constant text[] :=
    ARRAY['NDVI','EVI','GNDVI','MSAVI','NDRE','RECI','GCI','RENDVI','NDMI','PSRI'];
  v_missing_display int := 0;
  v_missing_analytical int := 0;
  v_missing_summary int := 0;
  v_package_status text := 'no_imagery';
  v_older_version_seen boolean := false;
BEGIN
  SELECT vineyard_id INTO v_vineyard_id
    FROM public.satellite_scenes
   WHERE paddock_id = p_paddock_id
   LIMIT 1;

  IF v_vineyard_id IS NULL THEN
    DELETE FROM public.satellite_paddock_manifest WHERE paddock_id = p_paddock_id;
    RETURN;
  END IF;

  -- Latest scene with any display raster (any version).
  SELECT s.id, s.acquired_at
    INTO v_latest_display_scene_id, v_latest_display_acquired_at
    FROM public.satellite_scenes s
    JOIN public.satellite_raster_assets a ON a.satellite_scene_id = s.id
   WHERE s.paddock_id = p_paddock_id
     AND s.processing_status = 'complete'
     AND a.asset_type = 'DISPLAY_RASTER'
   ORDER BY s.acquired_at DESC
   LIMIT 1;

  IF v_latest_display_scene_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT a.index_type), '{}')
      INTO v_display_types
      FROM public.satellite_raster_assets a
     WHERE a.satellite_scene_id = v_latest_display_scene_id
       AND a.asset_type = 'DISPLAY_RASTER'
       AND a.processing_version = v_current_version;

    SELECT COALESCE(array_agg(DISTINCT a.index_type), '{}')
      INTO v_analytical_types
      FROM public.satellite_raster_assets a
     WHERE a.satellite_scene_id = v_latest_display_scene_id
       AND a.asset_type = 'ANALYTICAL_RASTER'
       AND a.processing_version = v_current_version;

    SELECT EXISTS (
      SELECT 1 FROM public.satellite_raster_assets a
       WHERE a.satellite_scene_id = v_latest_display_scene_id
         AND a.processing_version <> v_current_version
    ) INTO v_older_version_seen;

    v_missing_display := (
      SELECT COUNT(*) FROM unnest(v_required_indices) i
       WHERE i <> ALL(v_display_types)
    );
    v_missing_analytical := (
      SELECT COUNT(*) FROM unnest(v_numeric_indices) i
       WHERE i <> ALL(v_analytical_types)
    );
    v_missing_summary := (
      SELECT COUNT(*) FROM unnest(v_numeric_indices) i
       WHERE NOT EXISTS (
         SELECT 1 FROM public.satellite_index_summaries su
          WHERE su.satellite_scene_id = v_latest_display_scene_id
            AND su.index_type = i
            AND su.processing_version = v_current_version
       )
    );

    IF v_missing_display = 0 AND v_missing_analytical = 0 AND v_missing_summary = 0 THEN
      v_package_status := 'complete';
      v_latest_complete_scene_id := v_latest_display_scene_id;
      v_latest_complete_acquired_at := v_latest_display_acquired_at;
    ELSIF v_older_version_seen AND v_missing_display + v_missing_analytical > 0 THEN
      v_package_status := 'upgrade_required';
    ELSE
      v_package_status := CASE WHEN v_missing_display = 0 THEN 'partial' ELSE 'display_available' END;
      IF array_length(v_display_types, 1) IS NULL THEN
        v_package_status := 'display_available';
      END IF;
    END IF;

    IF v_package_status <> 'complete' THEN
      SELECT s.id, s.acquired_at
        INTO v_latest_complete_scene_id, v_latest_complete_acquired_at
        FROM public.satellite_scenes s
       WHERE s.paddock_id = p_paddock_id
         AND s.processing_status = 'complete'
         AND NOT EXISTS (
           SELECT 1 FROM unnest(v_required_indices) i
            WHERE NOT EXISTS (
              SELECT 1 FROM public.satellite_raster_assets a
               WHERE a.satellite_scene_id = s.id
                 AND a.asset_type = 'DISPLAY_RASTER'
                 AND a.index_type = i
                 AND a.processing_version = v_current_version
            )
         )
       ORDER BY s.acquired_at DESC
       LIMIT 1;
    END IF;
  END IF;

  INSERT INTO public.satellite_paddock_manifest (
    vineyard_id, paddock_id,
    latest_display_scene_id, latest_display_acquired_at,
    latest_complete_scene_id, latest_complete_acquired_at,
    latest_processing_version,
    available_layer_types, available_analytical_types,
    missing_display_count, missing_analytical_count, missing_summary_count,
    package_status
  ) VALUES (
    v_vineyard_id, p_paddock_id,
    v_latest_display_scene_id, v_latest_display_acquired_at,
    v_latest_complete_scene_id, v_latest_complete_acquired_at,
    v_current_version,
    v_display_types, v_analytical_types,
    v_missing_display, v_missing_analytical, v_missing_summary,
    v_package_status
  )
  ON CONFLICT (vineyard_id, paddock_id) DO UPDATE
    SET latest_display_scene_id = EXCLUDED.latest_display_scene_id,
        latest_display_acquired_at = EXCLUDED.latest_display_acquired_at,
        latest_complete_scene_id = EXCLUDED.latest_complete_scene_id,
        latest_complete_acquired_at = EXCLUDED.latest_complete_acquired_at,
        latest_processing_version = EXCLUDED.latest_processing_version,
        available_layer_types = EXCLUDED.available_layer_types,
        available_analytical_types = EXCLUDED.available_analytical_types,
        missing_display_count = EXCLUDED.missing_display_count,
        missing_analytical_count = EXCLUDED.missing_analytical_count,
        missing_summary_count = EXCLUDED.missing_summary_count,
        package_status = EXCLUDED.package_status,
        updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_paddock_manifest(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_paddock_manifest(uuid) TO service_role;

-- ============ Triggers to keep manifest in sync ============
CREATE OR REPLACE FUNCTION public.satellite_scenes_manifest_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_paddock_manifest(OLD.paddock_id);
  ELSE
    PERFORM public.refresh_paddock_manifest(NEW.paddock_id);
    IF TG_OP = 'UPDATE' AND OLD.paddock_id <> NEW.paddock_id THEN
      PERFORM public.refresh_paddock_manifest(OLD.paddock_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS satellite_scenes_manifest_sync ON public.satellite_scenes;
CREATE TRIGGER satellite_scenes_manifest_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.satellite_scenes
  FOR EACH ROW EXECUTE FUNCTION public.satellite_scenes_manifest_sync();

CREATE OR REPLACE FUNCTION public.satellite_assets_manifest_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_paddock uuid;
BEGIN
  SELECT paddock_id INTO v_paddock FROM public.satellite_scenes
   WHERE id = COALESCE(NEW.satellite_scene_id, OLD.satellite_scene_id);
  IF v_paddock IS NOT NULL THEN
    PERFORM public.refresh_paddock_manifest(v_paddock);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS satellite_assets_manifest_sync ON public.satellite_raster_assets;
CREATE TRIGGER satellite_assets_manifest_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.satellite_raster_assets
  FOR EACH ROW EXECUTE FUNCTION public.satellite_assets_manifest_sync();

DROP TRIGGER IF EXISTS satellite_summaries_manifest_sync ON public.satellite_index_summaries;
CREATE TRIGGER satellite_summaries_manifest_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.satellite_index_summaries
  FOR EACH ROW EXECUTE FUNCTION public.satellite_assets_manifest_sync();

-- ============ One-time backfill ============
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT paddock_id FROM public.satellite_scenes LOOP
    PERFORM public.refresh_paddock_manifest(r.paddock_id);
  END LOOP;
END $$;
