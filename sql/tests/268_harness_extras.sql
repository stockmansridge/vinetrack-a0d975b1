-- Stand-ins for live columns/tables read by sql/268 (NOT for production).
alter table public.pins add column if not exists heading double precision, add column if not exists side text,
  add column if not exists trip_id uuid, add column if not exists created_at timestamptz default '2026-10-01T00:00:00Z';
alter table public.paddocks add column if not exists updated_at timestamptz;
create table if not exists public.pin_capture_evidence(pin_id uuid, captured_at timestamptz, horizontal_accuracy_m double precision,
  heading_degrees double precision, heading_observed_at timestamptz, pressed_side text, observations jsonb, geometry_hash text);
create table if not exists public.trips(id uuid primary key, vineyard_id uuid, path_points jsonb);

-- User-supplied live history shape. Identity is a TEST STUB, not a claimed export
-- of the production function. Rork must supply its actual definition for acceptance.
create table public.pin_location_geometry_history(
 id uuid primary key default gen_random_uuid(), paddock_id uuid, vineyard_id uuid,
 valid_from timestamptz, valid_to timestamptz, geometry_hash text,
 polygon_points jsonb, rows jsonb, recorded_at timestamptz, row_width numeric);
create function public.pin_geometry_identity(p_polygon jsonb,p_rows jsonb)
returns text language sql immutable as $$ select 'test-canonical:' || md5(p_polygon::text || '|' || p_rows::text) $$;
