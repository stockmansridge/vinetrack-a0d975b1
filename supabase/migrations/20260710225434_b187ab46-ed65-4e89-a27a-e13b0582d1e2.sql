UPDATE public.satellite_raster_assets
SET asset_type = 'DISPLAY_RASTER'
WHERE mime_type = 'image/png'
  AND asset_type IS DISTINCT FROM 'DISPLAY_RASTER';

UPDATE public.satellite_raster_assets
SET asset_type = 'ANALYTICAL_RASTER'
WHERE mime_type IN ('image/tiff', 'image/geotiff')
  AND asset_type IS DISTINCT FROM 'ANALYTICAL_RASTER';