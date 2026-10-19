-- Production evidence (19 Oct 2026): 313 storage objects are shared by more than one
-- processing_version (v3 and v6 rows point at the same version-free key, overwritten
-- in place), and saved 1 Aug 2026 rasters decode to zero visible pixels.
-- New rows may not claim another version's object, and v7 rows may not be published
-- without byte-level proof of visible pixels / valid analytical cells.
-- Existing rows and storage objects are not modified.
CREATE INDEX IF NOT EXISTS satellite_raster_assets_storage_path_idx
  ON public.satellite_raster_assets (storage_path);

CREATE OR REPLACE FUNCTION public.satellite_raster_asset_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.storage_path IS NULL OR length(NEW.storage_path) = 0 THEN
    RAISE EXCEPTION 'Raster asset storage path required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.satellite_raster_assets o
     WHERE o.storage_path = NEW.storage_path
       AND o.id <> NEW.id
       AND o.processing_version IS DISTINCT FROM NEW.processing_version
  ) THEN
    RAISE EXCEPTION 'Storage object is already owned by another processing version'
      USING ERRCODE = '23505';
  END IF;
  IF NEW.processing_version = 'sentinel2-v7-exact-native-pilot' THEN
    IF position('/' || NEW.processing_version || '/' IN NEW.storage_path) = 0 THEN
      RAISE EXCEPTION 'Verified raster path must be version-scoped';
    END IF;
    IF NOT COALESCE((NEW.provenance->>'valid_pixel_count')::integer > 0, false) THEN
      RAISE EXCEPTION 'Blank raster cannot be published: no valid pixels';
    END IF;
    IF NEW.asset_type = 'DISPLAY_RASTER'
       AND NOT COALESCE((NEW.provenance->>'display_visible_pixel_count')::integer > 0, false) THEN
      RAISE EXCEPTION 'Blank display raster cannot be published: zero visible pixels';
    END IF;
    IF NEW.asset_type = 'ANALYTICAL_RASTER'
       AND NOT COALESCE(
         (NEW.provenance->>'analytical_valid_cell_count')::integer > 0
         AND (NEW.provenance->>'analytical_valid_cell_count')::integer = (NEW.provenance->>'valid_pixel_count')::integer,
         false) THEN
      RAISE EXCEPTION 'Blank or mismatched analytical raster cannot be published';
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.satellite_raster_asset_identity_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS satellite_raster_asset_identity_guard ON public.satellite_raster_assets;
CREATE TRIGGER satellite_raster_asset_identity_guard
  BEFORE INSERT OR UPDATE OF storage_path, processing_version, provenance, asset_type
  ON public.satellite_raster_assets
  FOR EACH ROW EXECUTE FUNCTION public.satellite_raster_asset_identity_guard();