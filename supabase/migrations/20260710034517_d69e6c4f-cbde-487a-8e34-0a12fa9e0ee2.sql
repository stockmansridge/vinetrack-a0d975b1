
-- =========================================================================
-- Satellite Mapping Phase 2 — schema
-- =========================================================================

-- ---- satellite_scenes ----------------------------------------------------
CREATE TABLE public.satellite_scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vineyard_id uuid NOT NULL,
  paddock_id uuid NOT NULL,
  provider text NOT NULL,
  collection text NOT NULL,
  provider_scene_id text NOT NULL,
  acquired_at timestamptz NOT NULL,
  scene_cloud_cover_pct numeric,
  paddock_valid_coverage_pct numeric,
  paddock_cloud_cover_pct numeric,
  spatial_resolution_m numeric,
  quality_status text NOT NULL,
  processing_status text NOT NULL,
  source_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT satellite_scenes_provider_scene_paddock_uidx
    UNIQUE (provider, provider_scene_id, paddock_id)
);
CREATE INDEX satellite_scenes_paddock_acquired_idx
  ON public.satellite_scenes (paddock_id, acquired_at DESC);
CREATE INDEX satellite_scenes_vineyard_acquired_idx
  ON public.satellite_scenes (vineyard_id, acquired_at DESC);

GRANT ALL ON public.satellite_scenes TO service_role;
ALTER TABLE public.satellite_scenes ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated: all access via service_role in Edge Functions.

CREATE TRIGGER satellite_scenes_set_updated_at
  BEFORE UPDATE ON public.satellite_scenes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- satellite_raster_assets ---------------------------------------------
CREATE TABLE public.satellite_raster_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  satellite_scene_id uuid NOT NULL REFERENCES public.satellite_scenes(id) ON DELETE CASCADE,
  index_type text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  bounds jsonb,
  native_resolution_m numeric,
  display_resolution_m numeric,
  minimum_value numeric,
  maximum_value numeric,
  colour_scale jsonb,
  processing_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT satellite_raster_assets_scene_index_version_uidx
    UNIQUE (satellite_scene_id, index_type, processing_version)
);
CREATE INDEX satellite_raster_assets_scene_idx
  ON public.satellite_raster_assets (satellite_scene_id);

GRANT ALL ON public.satellite_raster_assets TO service_role;
ALTER TABLE public.satellite_raster_assets ENABLE ROW LEVEL SECURITY;

-- ---- satellite_index_summaries -------------------------------------------
CREATE TABLE public.satellite_index_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  satellite_scene_id uuid NOT NULL REFERENCES public.satellite_scenes(id) ON DELETE CASCADE,
  index_type text NOT NULL,
  mean_value numeric,
  median_value numeric,
  minimum_value numeric,
  maximum_value numeric,
  standard_deviation numeric,
  percentile_10 numeric,
  percentile_25 numeric,
  percentile_75 numeric,
  percentile_90 numeric,
  valid_pixel_count integer,
  no_data_pixel_count integer,
  processing_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT satellite_index_summaries_scene_index_version_uidx
    UNIQUE (satellite_scene_id, index_type, processing_version)
);
CREATE INDEX satellite_index_summaries_scene_idx
  ON public.satellite_index_summaries (satellite_scene_id);

GRANT ALL ON public.satellite_index_summaries TO service_role;
ALTER TABLE public.satellite_index_summaries ENABLE ROW LEVEL SECURITY;

-- ---- satellite_processing_jobs -------------------------------------------
CREATE TABLE public.satellite_processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vineyard_id uuid NOT NULL,
  paddock_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  provider text NOT NULL,
  job_type text NOT NULL,
  status text NOT NULL,
  requested_index_types text[],
  provider_scene_id text,
  attempt_count integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX satellite_processing_jobs_paddock_created_idx
  ON public.satellite_processing_jobs (paddock_id, created_at DESC);

GRANT ALL ON public.satellite_processing_jobs TO service_role;
ALTER TABLE public.satellite_processing_jobs ENABLE ROW LEVEL SECURITY;

-- ---- Storage: RLS on satellite-assets bucket -----------------------------
-- Bucket is private (created via storage_create_bucket tool).
-- Deny all client access; Edge Functions using service_role generate signed URLs.
CREATE POLICY "satellite_assets_service_role_only_select"
  ON storage.objects FOR SELECT TO service_role
  USING (bucket_id = 'satellite-assets');

CREATE POLICY "satellite_assets_service_role_only_insert"
  ON storage.objects FOR INSERT TO service_role
  WITH CHECK (bucket_id = 'satellite-assets');

CREATE POLICY "satellite_assets_service_role_only_update"
  ON storage.objects FOR UPDATE TO service_role
  USING (bucket_id = 'satellite-assets');

CREATE POLICY "satellite_assets_service_role_only_delete"
  ON storage.objects FOR DELETE TO service_role
  USING (bucket_id = 'satellite-assets');
