
drop index if exists public.chemical_lookup_cache_unique;

alter table public.chemical_lookup_cache
  add constraint chemical_lookup_cache_unique
  unique (query_normalised, country, product_name, manufacturer);
