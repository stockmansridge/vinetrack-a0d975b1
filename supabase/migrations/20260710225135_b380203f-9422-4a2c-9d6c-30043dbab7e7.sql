ALTER TABLE public.satellite_raster_assets
  ADD COLUMN IF NOT EXISTS asset_type text NOT NULL DEFAULT 'DISPLAY_RASTER',
  ADD COLUMN IF NOT EXISTS raster_width integer,
  ADD COLUMN IF NOT EXISTS raster_height integer,
  ADD COLUMN IF NOT EXISTS data_type text,
  ADD COLUMN IF NOT EXISTS scale_factor numeric,
  ADD COLUMN IF NOT EXISTS no_data_sentinel numeric,
  ADD COLUMN IF NOT EXISTS row_orientation text,
  ADD COLUMN IF NOT EXISTS acquisition_date date;

ALTER TABLE public.satellite_raster_assets
  DROP CONSTRAINT IF EXISTS satellite_raster_assets_scene_index_version_uidx;

ALTER TABLE public.satellite_raster_assets
  ADD CONSTRAINT satellite_raster_assets_scene_index_asset_version_uidx
  UNIQUE (satellite_scene_id, index_type, asset_type, processing_version);

CREATE INDEX IF NOT EXISTS satellite_raster_assets_lookup_idx
  ON public.satellite_raster_assets (satellite_scene_id, index_type, asset_type, processing_version);

UPDATE public.satellite_raster_assets
SET asset_type = 'DISPLAY_RASTER'
WHERE asset_type IS NULL OR asset_type = '';