-- 267 — Stockman's Ridge existing-pin row backfill (Stage 1 writeback).
-- PREPARED FOR RORK / OWNER — NOT APPLIED. Apply on the shared VineTrack database
-- (project tbafuqwruefgkbyxrxyb) only after Rork confirms the mobile meaning of
-- pin_row_number / driving_row_number / pin_side / snapped_latitude / snapped_longitude /
-- snapped_to_row / sync_version.
--
-- Scope: vineyard fe952afe-437f-4be7-8cbf-fdd8e630411c ONLY (hard-coded allow-list).
-- Writes happen only through pin_row_backfill_apply(), which requires:
--   * caller is System Admin AND owner/manager of the vineyard;
--   * a server-stored approval (created by pin_row_backfill_create_approval) whose
--     server-computed items hash matches, plus an exact typed confirmation phrase;
--   * every item passes the server dry-run again at apply time (any failure = no writes).
-- Raw latitude/longitude and capture evidence are never modified. Existing snapped_*
-- values are never rewritten. snapped_to_row is set true only after a verified bounded
-- orthogonal projection onto the chosen physical row segment inside the block polygon.
-- Audit rows are immutable.

begin;

-- ---------- 0. schema assertions (fail fast if the live shape differs) ----------
do $$
declare c text;
begin
  foreach c in array array['id','vineyard_id','paddock_id','latitude','longitude','row_number','pin_row_number',
    'driving_row_number','pin_side','location_scope','snapped_latitude','snapped_longitude','snapped_to_row',
    'sync_version','updated_at','deleted_at'] loop
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='pins' and column_name=c)
      then raise exception '267: public.pins.% missing — contract mismatch, do not apply', c; end if;
  end loop;
  if to_regclass('public.pin_row_segments') is null then raise exception '267: pin_row_segments missing'; end if;
  if to_regprocedure('public.is_system_admin()') is null then raise exception '267: is_system_admin() missing'; end if;
end $$;

-- ---------- 1. tables ----------
create table if not exists public.pin_row_backfill_approvals (
  id uuid primary key default gen_random_uuid(),
  vineyard_id uuid not null,
  items jsonb not null,                -- canonical, server-normalised items incl. frozen expected state
  items_hash text not null,            -- sha256 of items::text, computed server-side
  item_count integer not null,
  dry_run jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending_owner' check (status in ('pending_owner','applied','cancelled')),
  confirmed_by uuid,
  confirmed_at timestamptz,
  receipts jsonb
);
create table if not exists public.pin_row_backfill_audit (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.pin_row_backfill_approvals(id),
  pin_id uuid not null,
  vineyard_id uuid not null,
  actor uuid not null,
  outcome text not null,               -- 'assigned_snapped' | 'assigned_unsnapped'
  decision_source text not null,
  reason text not null,
  before jsonb not null,
  after jsonb not null,
  projection jsonb,
  created_at timestamptz not null default now(),
  unique (approval_id, pin_id)
);

revoke all on public.pin_row_backfill_approvals from public, anon, authenticated;
revoke all on public.pin_row_backfill_audit from public, anon, authenticated;
grant select on public.pin_row_backfill_approvals to authenticated;
grant select on public.pin_row_backfill_audit to authenticated;
grant all on public.pin_row_backfill_approvals to service_role;
grant all on public.pin_row_backfill_audit to service_role;
alter table public.pin_row_backfill_approvals enable row level security;
alter table public.pin_row_backfill_audit enable row level security;

-- ---------- 2. authorisation ----------
create or replace function public.vt_pbf_authorized(p_vineyard uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_vineyard = 'fe952afe-437f-4be7-8cbf-fdd8e630411c'::uuid
     and auth.uid() is not null
     and public.is_system_admin()
     and exists (select 1 from public.vineyard_members m
                 where m.vineyard_id = p_vineyard and m.user_id = auth.uid()
                   and lower(m.role::text) in ('owner','manager'));
$$;
revoke all on function public.vt_pbf_authorized(uuid) from public, anon;
grant execute on function public.vt_pbf_authorized(uuid) to authenticated;

drop policy if exists pbf_approvals_select on public.pin_row_backfill_approvals;
create policy pbf_approvals_select on public.pin_row_backfill_approvals for select to authenticated
  using (public.vt_pbf_authorized(vineyard_id));
drop policy if exists pbf_audit_select on public.pin_row_backfill_audit;
create policy pbf_audit_select on public.pin_row_backfill_audit for select to authenticated
  using (public.vt_pbf_authorized(vineyard_id));

create or replace function public.vt_pbf_audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'pin_row_backfill_audit is immutable'; end $$;
drop trigger if exists pbf_audit_immutable on public.pin_row_backfill_audit;
create trigger pbf_audit_immutable before update or delete on public.pin_row_backfill_audit
  for each row execute function public.vt_pbf_audit_immutable();

-- ---------- 3. geometry helpers ----------
-- Normalise only for geometry maths, never for canonical hashing or persisted data.
create or replace function public.vt_pbf_rows(p_rows jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(r || jsonb_build_object('number',coalesce(r->'number',r->'rowNumber'))),'[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_rows)='array' then p_rows else '[]'::jsonb end) r;
$$;
revoke all on function public.vt_pbf_rows(jsonb) from public, anon, authenticated;

create or replace function public.vt_pbf_geometry_identity(p_polygon jsonb, p_rows jsonb)
returns text language sql immutable set search_path = public as $$
  select 'pbf-md5:' || md5(coalesce(p_polygon::text,'null') || '|' || coalesce(p_rows::text,'null'));
$$;

create or replace function public.vt_pbf_pt(p jsonb, out lat double precision, out lon double precision)
language sql immutable set search_path = public as $$
  select coalesce((p->>'latitude'),(p->>'lat'))::double precision,
         coalesce((p->>'longitude'),(p->>'lng'),(p->>'lon'))::double precision;
$$;

create or replace function public.vt_pbf_point_in_polygon(p_lat double precision, p_lon double precision, p_poly jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare n int; i int; j int; ai record; aj record; inside boolean := false;
begin
  if p_poly is null or jsonb_typeof(p_poly) <> 'array' then return null; end if;
  n := jsonb_array_length(p_poly);
  if n < 3 then return null; end if;
  j := n - 1;
  for i in 0..n-1 loop
    select * into ai from public.vt_pbf_pt(p_poly->i);
    select * into aj from public.vt_pbf_pt(p_poly->j);
    if ((ai.lat > p_lat) <> (aj.lat > p_lat))
       and p_lon < (aj.lon - ai.lon) * (p_lat - ai.lat) / (aj.lat - ai.lat) + ai.lon then inside := not inside; end if;
    j := i;
  end loop;
  return inside;
end $$;

-- Bounded orthogonal projection of the RAW GPS onto the chosen row's straight segment.
-- Verifies: chosen row exists with endpoints; projection lies within the segment
-- (5%..95% of length); chosen row is one of the two nearest rows; the aisle on the
-- pin's side is (chosen + neighbour)/2; distance ≤ 0.75 × local row spacing.
create or replace function public.vt_pbf_project(p_lat double precision, p_lon double precision, p_rows jsonb, p_row int)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  kx double precision := 111320 * cos(radians(p_lat)); ky double precision := 110574;
  r jsonb; s record; e record; num int;
  best jsonb := null; dists jsonb := '[]'::jsonb;
  dx double precision; dy double precision; px double precision; py double precision;
  len2 double precision; t double precision; d double precision; v_cross double precision;
  ch jsonb; nb jsonb; spacing double precision;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return jsonb_build_object('ok',false,'reason','no rows'); end if;
  for r in select * from jsonb_array_elements(public.vt_pbf_rows(p_rows)) loop
    num := (r->>'number')::int;
    select * into s from public.vt_pbf_pt(coalesce(r->'startPoint', r->'start'));
    select * into e from public.vt_pbf_pt(coalesce(r->'endPoint', r->'end'));
    continue when num is null or s.lat is null or e.lat is null;
    dx := (e.lon - s.lon) * kx; dy := (e.lat - s.lat) * ky;
    px := (p_lon - s.lon) * kx; py := (p_lat - s.lat) * ky;
    len2 := dx*dx + dy*dy; continue when len2 < 1;
    t := (px*dx + py*dy) / len2;
    d := abs(px*dy - py*dx) / sqrt(len2);
    v_cross := sign(dx*py - dy*px);
    dists := dists || jsonb_build_object('n',num,'d',d,'t',t,'side',v_cross,
      'sl', s.lat + (e.lat - s.lat) * t, 'so', s.lon + (e.lon - s.lon) * t, 'len', sqrt(len2));
  end loop;
  select x into ch from jsonb_array_elements(dists) x where (x->>'n')::int = p_row;
  if ch is null then return jsonb_build_object('ok',false,'reason','chosen row has no mapped endpoints'); end if;
  -- neighbour on the pin's side of the chosen row: nearest other row whose signed side differs
  select x into nb from jsonb_array_elements(dists) x
    where (x->>'n')::int <> p_row and (x->>'side')::double precision <> (ch->>'side')::double precision
    order by (x->>'d')::double precision limit 1;
  if not exists (select 1 from (select (x->>'n')::int n from jsonb_array_elements(dists) x
                   order by (x->>'d')::double precision limit 2) q where q.n = p_row)
    then return jsonb_build_object('ok',false,'reason','chosen row is not one of the two nearest rows','distance_m',ch->'d'); end if;
  if nb is null then return jsonb_build_object('ok',false,'reason','no neighbouring row on the pin side (outside rows)'); end if;
  spacing := (ch->>'d')::double precision + (nb->>'d')::double precision;
  if (ch->>'t')::double precision < 0.05 or (ch->>'t')::double precision > 0.95 then
    return jsonb_build_object('ok',false,'reason','projection outside row segment interior (headland / row end)','t',ch->'t'); end if;
  if (ch->>'d')::double precision > 0.75 * spacing then
    return jsonb_build_object('ok',false,'reason','GPS too far from chosen row relative to spacing','distance_m',ch->'d','spacing_m',spacing); end if;
  return jsonb_build_object('ok',true,'t',ch->'t','distance_m',ch->'d','spacing_m',spacing,
    'neighbour_row',(nb->>'n')::int,'aisle',((p_row + (nb->>'n')::int)::numeric / 2),
    'snapped_latitude',ch->'sl','snapped_longitude',ch->'so');
end $$;

-- ---------- 4. per-item dry-run (no writes) ----------
-- item: { pin_id, paddock_id, pin_row_number, driving_row_number?, pin_side?, source, reason,
--         expected_sync_version, expected_updated_at, expected_latitude, expected_longitude }
create or replace function public.vt_pbf_check_item(p_vineyard uuid, it jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p record; pad record; proj jsonb; fails text[] := '{}'; v_row int; v_aisle numeric; v_side text;
  v_src text := it->>'source'; inside boolean; will_snap boolean := false; ident text;
begin
  select * into p from public.pins where id = (it->>'pin_id')::uuid;
  if not found then return jsonb_build_object('pin_id',it->>'pin_id','ok',false,'fails',array['pin not found']); end if;
  if not public.vt_pbf_authorized(p_vineyard) or p.vineyard_id is distinct from p_vineyard then
    return jsonb_build_object('pin_id',it->>'pin_id','ok',false,'fails',array['pin not in authorised vineyard']); end if;
  if p.deleted_at is not null then fails := array_append(fails, 'pin deleted'); end if;
  if p.row_number is not null or p.pin_row_number is not null then fails := array_append(fails, 'pin already has a row'); end if;
  if p.driving_row_number is not null then fails := array_append(fails, 'pin already has a driving aisle (preserved)'); end if;
  if exists (select 1 from public.pin_row_segments s where s.pin_id = p.id) then fails := array_append(fails, 'pin has row segments (preserved)'); end if;
  if coalesce(p.location_scope,'') = 'row' then fails := array_append(fails, 'location_scope is row'); end if;
  if v_src is null or v_src not in ('measured','reviewed_track','manual_field_check') then fails := array_append(fails, 'invalid source'); end if;
  if coalesce(btrim(it->>'reason'),'') = '' then fails := array_append(fails, 'reason required'); end if;
  -- CAS on the live record
  if p.sync_version::text is distinct from (it->>'expected_sync_version') then fails := array_append(fails, 'sync_version changed'); end if;
  if p.updated_at is distinct from (it->>'expected_updated_at')::timestamptz then fails := array_append(fails, 'updated_at changed'); end if;
  if p.latitude::double precision is distinct from (it->>'expected_latitude')::double precision
     or p.longitude::double precision is distinct from (it->>'expected_longitude')::double precision then fails := array_append(fails, 'raw GPS changed'); end if;
  if p.latitude is null or p.longitude is null then fails := array_append(fails, 'no raw GPS'); end if;
  -- block
  if p.paddock_id is not null and p.paddock_id <> (it->>'paddock_id')::uuid then fails := array_append(fails, 'BLOCK-CONFLICT: differs from saved block'); end if;
  select id, vineyard_id, polygon_points, rows into pad from public.paddocks where id = (it->>'paddock_id')::uuid and deleted_at is null;
  if not found or pad.vineyard_id <> p_vineyard then fails := array_append(fails, 'block not in vineyard');
  else
    ident := public.vt_pbf_geometry_identity(pad.polygon_points::jsonb, pad.rows::jsonb);
    if it ? 'expected_geometry_identity' and it->>'expected_geometry_identity' <> ident then fails := array_append(fails, 'block geometry changed'); end if;
    inside := public.vt_pbf_point_in_polygon(p.latitude, p.longitude, pad.polygon_points::jsonb);
    if inside is distinct from true then fails := array_append(fails, 'raw GPS not inside current block polygon'); end if;
  end if;
  if nullif(it->>'pin_row_number','')::numeric is distinct from trunc(nullif(it->>'pin_row_number','')::numeric) then
    return jsonb_build_object('pin_id',p.id,'ok',false,'fails',array['physical row must be an integer; no rounding']); end if;
  v_row := nullif(it->>'pin_row_number','')::numeric::int;
  if v_row is null then fails := array_append(fails, 'pin_row_number required'); end if;
  if pad.id is not null and v_row is not null and not exists (select 1 from jsonb_array_elements(public.vt_pbf_rows(pad.rows::jsonb)) r where (r->>'number')::int = v_row)
    then fails := array_append(fails, 'row does not exist in block'); end if;
  -- side: never contradict, never invent without field check
  v_side := lower(nullif(it->>'pin_side',''));
  if v_side is not null and v_side not in ('left','right') then fails := array_append(fails, 'invalid side'); end if;
  if v_side is not null and p.pin_side is not null and lower(p.pin_side) <> v_side then fails := array_append(fails, 'side contradicts recorded pin_side'); end if;
  if v_side is not null and p.pin_side is null and v_src <> 'manual_field_check' then fails := array_append(fails, 'side not recorded — only manual_field_check may supply it'); end if;
  -- projection
  if pad.id is not null and v_row is not null and p.latitude is not null then
    proj := public.vt_pbf_project(p.latitude, p.longitude, pad.rows::jsonb, v_row);
  end if;
  v_aisle := nullif(it->>'driving_row_number','')::numeric;
  if v_aisle is not null then
    if abs(v_aisle - v_row) <> 0.5 then fails := array_append(fails, 'driving aisle not adjacent to row');
    elsif coalesce((proj->>'ok')::boolean,false) is false or (proj->>'aisle')::numeric <> v_aisle then
      if v_src <> 'manual_field_check' then fails := array_append(fails, 'driving aisle not verified by projection'); end if;
    end if;
  end if;
  if v_src <> 'manual_field_check' and coalesce((proj->>'ok')::boolean,false) is false then
    fails := array_append(fails, ('projection failed: ' || coalesce(proj->>'reason','n/a') || ' — needs manual_field_check'));
  end if;
  will_snap := coalesce((proj->>'ok')::boolean,false) and p.snapped_latitude is null and p.snapped_longitude is null
               and coalesce(p.snapped_to_row,false) = false;
  return jsonb_build_object('pin_id',p.id,'ok',cardinality(fails)=0,'fails',fails,
    'outcome', case when cardinality(fails)>0 then 'blocked' when will_snap then 'assigned_snapped' else 'assigned_unsnapped' end,
    'projection',proj,'geometry_identity',ident,
    'existing_snap_kept', (p.snapped_latitude is not null or p.snapped_longitude is not null),
    'raw_latitude',p.latitude,'raw_longitude',p.longitude,
    'saved_snapped_latitude',p.snapped_latitude,'saved_snapped_longitude',p.snapped_longitude);
end $$;
revoke all on function public.vt_pbf_check_item(uuid, jsonb) from public, anon, authenticated;

create or replace function public.pin_row_backfill_dry_run(p_vineyard uuid, p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare it jsonb; res jsonb := '[]'::jsonb; ids uuid[] := '{}';
begin
  if not public.vt_pbf_authorized(p_vineyard) then raise exception 'not authorised' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 200
    then raise exception 'items must be a non-empty array of at most 200'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if (it->>'pin_id')::uuid = any(ids) then raise exception 'duplicate pin %', it->>'pin_id'; end if;
    ids := ids || (it->>'pin_id')::uuid;
    res := res || public.vt_pbf_check_item(p_vineyard, it);
  end loop;
  return jsonb_build_object('items',res,
    'ok',(select count(*) from jsonb_array_elements(res) x where (x->>'ok')::boolean),
    'blocked',(select count(*) from jsonb_array_elements(res) x where not (x->>'ok')::boolean));
end $$;

-- ---------- 5. approval (freezes server state; refuses if any item blocked) ----------
create or replace function public.pin_row_backfill_create_approval(p_vineyard uuid, p_items jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare dr jsonb; frozen jsonb := '[]'::jsonb; it jsonb; chk jsonb; v_id uuid; v_hash text;
begin
  dr := public.pin_row_backfill_dry_run(p_vineyard, p_items);
  if (dr->>'blocked')::int > 0 then raise exception 'dry-run has % blocked item(s); approval refused', dr->>'blocked'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    chk := public.vt_pbf_check_item(p_vineyard, it);
    frozen := frozen || (it || jsonb_build_object('expected_geometry_identity', chk->>'geometry_identity'));
  end loop;
  v_hash := encode(sha256(convert_to(frozen::text,'UTF8')),'hex');
  insert into public.pin_row_backfill_approvals(vineyard_id, items, items_hash, item_count, dry_run, created_by)
    values (p_vineyard, frozen, v_hash, jsonb_array_length(frozen), dr, auth.uid()) returning id into v_id;
  return jsonb_build_object('approval_id',v_id,'items_hash',v_hash,'item_count',jsonb_array_length(frozen),
    'confirm_phrase', 'APPLY ' || jsonb_array_length(frozen) || ' PIN ROWS');
end $$;

-- ---------- 6. apply (owner confirmation, all-or-nothing, idempotent) ----------
create or replace function public.pin_row_backfill_apply(p_approval uuid, p_items_hash text, p_confirm text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a record; it jsonb; chk jsonb; p record; v_receipts jsonb := '[]'::jsonb; proj jsonb; snap boolean;
  v_after jsonb; v_before jsonb;
begin
  select * into a from public.pin_row_backfill_approvals where id = p_approval for update;
  if not found then raise exception 'approval not found'; end if;
  if not public.vt_pbf_authorized(a.vineyard_id) then raise exception 'not authorised' using errcode = '42501'; end if;
  if a.status = 'applied' then return jsonb_build_object('idempotent',true,'receipts',a.receipts); end if;
  if a.status <> 'pending_owner' then raise exception 'approval is %', a.status; end if;
  if p_items_hash is distinct from a.items_hash then raise exception 'items hash mismatch'; end if;
  if p_confirm is distinct from ('APPLY ' || a.item_count || ' PIN ROWS') then raise exception 'confirmation phrase mismatch'; end if;
  if a.created_at < now() - interval '24 hours' then raise exception 'approval expired; create a new one'; end if;
  -- Lock ALL target pins before checking (not after the check); a failure rolls back all.
  perform 1 from public.pins p0 where p0.id in
    (select (x->>'pin_id')::uuid from jsonb_array_elements(a.items) x) order by p0.id for update;
  perform 1 from public.paddocks d where d.id in
    (select (x->>'paddock_id')::uuid from jsonb_array_elements(a.items) x) order by d.id for share;
  -- Re-run every check; a single failure blocks all writes.
  for it in select * from jsonb_array_elements(a.items) loop
    chk := public.vt_pbf_check_item(a.vineyard_id, it);
    if not (chk->>'ok')::boolean then raise exception 'pin % blocked at apply: %', it->>'pin_id', chk->'fails'; end if;
  end loop;
  for it in select * from jsonb_array_elements(a.items) loop
    chk := public.vt_pbf_check_item(a.vineyard_id, it);
    proj := chk->'projection';
    snap := chk->>'outcome' = 'assigned_snapped';
    select * into p from public.pins where id = (it->>'pin_id')::uuid for update;
    v_before := jsonb_build_object('paddock_id',p.paddock_id,'pin_row_number',p.pin_row_number,'driving_row_number',p.driving_row_number,
      'pin_side',p.pin_side,'snapped_latitude',p.snapped_latitude,'snapped_longitude',p.snapped_longitude,'snapped_to_row',p.snapped_to_row,
      'sync_version',p.sync_version,'updated_at',p.updated_at,'latitude',p.latitude,'longitude',p.longitude);
    update public.pins set
      paddock_id = coalesce(paddock_id, (it->>'paddock_id')::uuid),
      pin_row_number = (it->>'pin_row_number')::int,
      driving_row_number = coalesce(nullif(it->>'driving_row_number','')::numeric, driving_row_number),
      pin_side = coalesce(pin_side, nullif(lower(it->>'pin_side'),'')),
      snapped_latitude = case when snap then (proj->>'snapped_latitude')::double precision else snapped_latitude end,
      snapped_longitude = case when snap then (proj->>'snapped_longitude')::double precision else snapped_longitude end,
      snapped_to_row = case when snap then true else snapped_to_row end,
      sync_version = sync_version + 1,
      updated_at = now()
    where id = p.id and sync_version::text = it->>'expected_sync_version'
    returning jsonb_build_object('paddock_id',paddock_id,'pin_row_number',pin_row_number,'driving_row_number',driving_row_number,
      'pin_side',pin_side,'snapped_latitude',snapped_latitude,'snapped_longitude',snapped_longitude,'snapped_to_row',snapped_to_row,
      'sync_version',sync_version,'updated_at',updated_at,'latitude',latitude,'longitude',longitude) into v_after;
    if v_after is null then raise exception 'CAS lost for pin %', p.id; end if;
    insert into public.pin_row_backfill_audit(approval_id,pin_id,vineyard_id,actor,outcome,decision_source,reason,before,after,projection)
      values (a.id, p.id, a.vineyard_id, auth.uid(), chk->>'outcome', it->>'source', it->>'reason', v_before, v_after, proj);
    v_receipts := v_receipts || jsonb_build_object('pin_id',p.id,'outcome',chk->>'outcome','after',v_after);
  end loop;
  update public.pin_row_backfill_approvals set status='applied', confirmed_by=auth.uid(), confirmed_at=now(), receipts=v_receipts where id=a.id;
  return jsonb_build_object('idempotent',false,'receipts',v_receipts);
end $$;

revoke all on function public.pin_row_backfill_dry_run(uuid, jsonb) from public, anon;
revoke all on function public.pin_row_backfill_create_approval(uuid, jsonb) from public, anon;
revoke all on function public.pin_row_backfill_apply(uuid, text, text) from public, anon;
grant execute on function public.pin_row_backfill_dry_run(uuid, jsonb) to authenticated;
grant execute on function public.pin_row_backfill_create_approval(uuid, jsonb) to authenticated;
grant execute on function public.pin_row_backfill_apply(uuid, text, text) to authenticated;
revoke all on function public.vt_pbf_project(double precision, double precision, jsonb, int) from public, anon;
revoke all on function public.vt_pbf_point_in_polygon(double precision, double precision, jsonb) from public, anon;

commit;
