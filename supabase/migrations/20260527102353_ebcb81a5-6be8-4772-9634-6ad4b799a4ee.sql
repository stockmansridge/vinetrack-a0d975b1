ALTER TABLE public.chemical_lookup_cache
  ADD COLUMN IF NOT EXISTS product_url text,
  ADD COLUMN IF NOT EXISTS sds_url     text;