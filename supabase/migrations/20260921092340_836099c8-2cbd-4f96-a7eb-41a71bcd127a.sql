REVOKE ALL ON public.email_list_subscribers FROM anon;
REVOKE ALL ON public.email_list_subscribers FROM authenticated;
GRANT ALL ON public.email_list_subscribers TO service_role;
COMMENT ON TABLE public.email_list_subscribers IS 'RETIRED legacy copy. The canonical VineTrack database owns email_list_subscribers (sql/242). Kept empty as a cutover fallback only; no client role has any privilege here.';