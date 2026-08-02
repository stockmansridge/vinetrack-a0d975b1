-- 1. Duplicate protection for imagery -------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS satellite_scenes_unique_capture_idx
  ON public.satellite_scenes (vineyard_id, paddock_id, provider, ((acquired_at AT TIME ZONE 'UTC')::date));

CREATE UNIQUE INDEX IF NOT EXISTS satellite_raster_assets_unique_idx
  ON public.satellite_raster_assets (satellite_scene_id, index_type, asset_type, processing_version);

-- 2. Expected imagery dates + outcomes ------------------------------------
CREATE TABLE IF NOT EXISTS public.satellite_expected_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vineyard_id uuid NOT NULL,
  paddock_id uuid NOT NULL,
  index_type text NOT NULL,
  expected_date date NOT NULL,
  provider text NOT NULL DEFAULT 'CDSE_SENTINEL_HUB',
  outcome text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  last_error text,
  satellite_scene_id uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT satellite_expected_dates_outcome_chk CHECK (outcome IN (
    'pending','available','downloaded','processing','no_provider_capture',
    'cloud_obscured','invalid_coverage','failed','retry_pending'
  )),
  CONSTRAINT satellite_expected_dates_unique UNIQUE (vineyard_id, paddock_id, index_type, expected_date)
);

CREATE INDEX IF NOT EXISTS satellite_expected_dates_lookup_idx
  ON public.satellite_expected_dates (vineyard_id, index_type, expected_date DESC);
CREATE INDEX IF NOT EXISTS satellite_expected_dates_outcome_idx
  ON public.satellite_expected_dates (vineyard_id, outcome, expected_date DESC);

GRANT ALL ON public.satellite_expected_dates TO service_role;
ALTER TABLE public.satellite_expected_dates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages expected dates"
  ON public.satellite_expected_dates FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 3. Persistent backfill jobs ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.satellite_backfill_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vineyard_id uuid NOT NULL,
  requested_paddock_ids uuid[] NOT NULL DEFAULT '{}',
  index_types text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued',
  requested_by uuid,
  auto_scheduled boolean NOT NULL DEFAULT false,
  newest_date_checked date,
  oldest_date_checked date,
  current_processing_date date,
  current_paddock_id uuid,
  missing_dates_found integer NOT NULL DEFAULT 0,
  dates_completed integer NOT NULL DEFAULT 0,
  dates_skipped integer NOT NULL DEFAULT 0,
  dates_failed integer NOT NULL DEFAULT 0,
  paddocks_total integer NOT NULL DEFAULT 0,
  paddocks_completed integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  heartbeat_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT satellite_backfill_jobs_status_chk CHECK (status IN (
    'queued','discovering','downloading','processing','completed',
    'completed_with_warnings','failed','cancelled'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS satellite_backfill_jobs_one_active_idx
  ON public.satellite_backfill_jobs (vineyard_id)
  WHERE status IN ('queued','discovering','downloading','processing');

CREATE INDEX IF NOT EXISTS satellite_backfill_jobs_recent_idx
  ON public.satellite_backfill_jobs (vineyard_id, created_at DESC);

GRANT ALL ON public.satellite_backfill_jobs TO service_role;
ALTER TABLE public.satellite_backfill_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages backfill jobs"
  ON public.satellite_backfill_jobs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. Per-vineyard backfill settings ---------------------------------------
CREATE TABLE IF NOT EXISTS public.satellite_backfill_settings (
  vineyard_id uuid PRIMARY KEY,
  auto_backfill boolean NOT NULL DEFAULT false,
  cadence_days integer NOT NULL DEFAULT 5,
  history_days integer NOT NULL DEFAULT 180,
  last_auto_check_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.satellite_backfill_settings TO service_role;
ALTER TABLE public.satellite_backfill_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages backfill settings"
  ON public.satellite_backfill_settings FOR ALL TO service_role
  USING (true) WITH CHECK (true);
