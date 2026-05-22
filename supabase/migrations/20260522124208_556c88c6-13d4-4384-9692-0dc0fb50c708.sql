
create table if not exists public.chemical_lookup_cache (
  id uuid primary key default gen_random_uuid(),
  query_normalised text not null,
  country text not null default '',
  product_name text not null,
  manufacturer text not null default '',
  active_ingredient text,
  category text,
  chemical_group text,
  product_type text,
  unit text,
  rate_basis text,
  rate_per_unit numeric,
  withholding_period_days integer,
  re_entry_period_hours integer,
  target text,
  notes text,
  safety_note text,
  country_confirmed boolean,
  confidence text,
  source_hint text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists chemical_lookup_cache_unique
  on public.chemical_lookup_cache (query_normalised, country, lower(product_name), lower(manufacturer));

create index if not exists chemical_lookup_cache_query_idx
  on public.chemical_lookup_cache (query_normalised, country);

alter table public.chemical_lookup_cache enable row level security;

create policy "Authenticated can read chemical lookup cache"
  on public.chemical_lookup_cache
  for select
  to authenticated
  using (true);

create policy "Service role can manage chemical lookup cache"
  on public.chemical_lookup_cache
  for all
  to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
