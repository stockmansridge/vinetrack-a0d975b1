-- Stand-ins for live columns/tables read by sql/268 (NOT for production).
alter table public.pins add column if not exists heading double precision, add column if not exists side text,
  add column if not exists trip_id uuid, add column if not exists created_at timestamptz default '2026-10-01T00:00:00Z';
alter table public.paddocks add column if not exists updated_at timestamptz;
create table if not exists public.pin_capture_evidence(pin_id uuid, captured_at timestamptz, horizontal_accuracy_m double precision,
  heading_degrees double precision, heading_observed_at timestamptz, pressed_side text, observations jsonb, geometry_hash text);
create table if not exists public.trips(id uuid primary key, path_points jsonb);
