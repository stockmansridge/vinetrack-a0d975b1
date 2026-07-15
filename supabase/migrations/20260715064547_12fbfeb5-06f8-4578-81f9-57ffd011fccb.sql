REVOKE EXECUTE ON FUNCTION public.claim_refresh_job(uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_stale_refresh_jobs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finish_refresh_job(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.heartbeat_refresh_job(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_paddock_manifest(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.satellite_assets_manifest_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.satellite_scenes_manifest_sync() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_refresh_job(uuid, text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_refresh_jobs() TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_refresh_job(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_refresh_job(uuid, uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_paddock_manifest(uuid) TO service_role;