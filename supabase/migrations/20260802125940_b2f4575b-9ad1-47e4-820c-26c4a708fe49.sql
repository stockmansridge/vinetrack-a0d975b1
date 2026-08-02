DROP POLICY IF EXISTS "Authenticated can read chemical lookup cache" ON public.chemical_lookup_cache;
REVOKE ALL ON public.chemical_lookup_cache FROM anon, authenticated;
GRANT ALL ON public.chemical_lookup_cache TO service_role;