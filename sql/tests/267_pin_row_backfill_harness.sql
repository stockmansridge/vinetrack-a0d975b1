-- Local harness for sql/267 (NOT for production). Minimal stand-ins for the live schema.
create extension if not exists pgcrypto;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$; do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$; do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create table public.system_admins(user_id uuid primary key);
create function public.is_system_admin() returns boolean language sql stable as $$ select exists(select 1 from public.system_admins where user_id = auth.uid()) $$;
create table public.vineyard_members(vineyard_id uuid, user_id uuid, role text);
create table public.paddocks(id uuid primary key, vineyard_id uuid, polygon_points jsonb, rows jsonb, deleted_at timestamptz);
create table public.pins(id uuid primary key, vineyard_id uuid, paddock_id uuid, latitude double precision, longitude double precision,
  row_number int, pin_row_number int, driving_row_number numeric, pin_side text, side text, location_scope text,
  snapped_latitude double precision, snapped_longitude double precision, snapped_to_row boolean default false,
  sync_version int default 1, updated_at timestamptz default '2026-10-14T00:00:00Z', deleted_at timestamptz);
create table public.pin_row_segments(pin_id uuid, row_number int, segment_number int);
