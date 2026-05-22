alter table public.chemical_lookup_cache
  add column if not exists product_name_normalised text,
  add column if not exists manufacturer_normalised text,
  add column if not exists times_seen integer not null default 1,
  add column if not exists was_applied boolean not null default false;

update public.chemical_lookup_cache
set product_name_normalised = lower(regexp_replace(product_name, '[^a-zA-Z0-9]+', '', 'g')),
    manufacturer_normalised = lower(regexp_replace(manufacturer, '[^a-zA-Z0-9]+', '', 'g'))
where product_name_normalised is null
   or manufacturer_normalised is null
   or product_name_normalised = ''
   or manufacturer_normalised = '';

with ranked as (
  select ctid,
         row_number() over (
           partition by query_normalised,
                        country,
                        coalesce(product_name_normalised, lower(regexp_replace(product_name, '[^a-zA-Z0-9]+', '', 'g'))),
                        coalesce(manufacturer_normalised, lower(regexp_replace(manufacturer, '[^a-zA-Z0-9]+', '', 'g')))
           order by was_applied desc, times_seen desc, last_seen_at desc, created_at desc
         ) as rn
  from public.chemical_lookup_cache
)
delete from public.chemical_lookup_cache c
using ranked r
where c.ctid = r.ctid
  and r.rn > 1;

alter table public.chemical_lookup_cache
  alter column product_name_normalised set not null,
  alter column manufacturer_normalised set not null;

alter table public.chemical_lookup_cache
  drop constraint if exists chemical_lookup_cache_unique;

drop index if exists public.chemical_lookup_cache_unique;

alter table public.chemical_lookup_cache
  add constraint chemical_lookup_cache_unique
  unique (query_normalised, country, product_name_normalised, manufacturer_normalised);

create index if not exists chemical_lookup_cache_query_seen_idx
  on public.chemical_lookup_cache (query_normalised, country, was_applied desc, times_seen desc, last_seen_at desc);

create index if not exists chemical_lookup_cache_product_norm_idx
  on public.chemical_lookup_cache (query_normalised, product_name_normalised, country);