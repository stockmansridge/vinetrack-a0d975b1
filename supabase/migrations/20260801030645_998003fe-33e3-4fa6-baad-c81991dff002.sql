REVOKE ALL ON public.satellite_processing_jobs FROM anon, authenticated;
REVOKE ALL ON public.satellite_raster_assets FROM anon, authenticated;
REVOKE ALL ON public.satellite_scenes FROM anon, authenticated;

GRANT ALL ON public.satellite_processing_jobs TO service_role;
GRANT ALL ON public.satellite_raster_assets TO service_role;
GRANT ALL ON public.satellite_scenes TO service_role;

ALTER TABLE public.satellite_processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.satellite_raster_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.satellite_scenes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages satellite processing jobs" ON public.satellite_processing_jobs;
CREATE POLICY "Service role manages satellite processing jobs"
ON public.satellite_processing_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role manages satellite raster assets" ON public.satellite_raster_assets;
CREATE POLICY "Service role manages satellite raster assets"
ON public.satellite_raster_assets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role manages satellite scenes" ON public.satellite_scenes;
CREATE POLICY "Service role manages satellite scenes"
ON public.satellite_scenes FOR ALL TO service_role USING (true) WITH CHECK (true);