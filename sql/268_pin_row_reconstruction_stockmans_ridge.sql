-- 268 — Stockman's Ridge server-side THREE-INPUT row reconstruction + 267 dry-run gate.
-- PREPARED FOR RORK — NOT APPLIED. Apply on the shared VineTrack DB (tbafuqwruefgkbyxrxyb) only
-- AFTER sql/267, and only after a specific batch is approved by the owner.
--
-- Algorithm: 'pbf-recon-v1'. Read-only: the reconstruction functions are STABLE and never write.
-- Three components, each with explicit availability / quality / provenance:
--   1. GPS          raw lat/lon (never altered), capture time, accuracy, raw vs saved snap, sample history.
--   2. TRAVEL       from qualified timestamped GPS course observations and/or a short straight ordered
--                   trip path around a UNIQUE exact coordinate anchor. Device/phone compass heading is
--                   recorded for comparison only and is NEVER used as travel direction.
--   3. LEFT/RIGHT   only explicitly stored pins.pin_side / pins.side / pin_capture_evidence.pressed_side.
--                   Never inferred from proximity. Missing or conflicting → HOLD (missing_side).
-- Tiers (no percentages): technically_supported, needs_review, missing_side, missing_direction,
--                         missing_block, preserved, field_confirmed.
-- Optional live columns (pins.heading/side/trip_id/created_at, paddocks.updated_at) are read through
-- to_jsonb(row) so an absent column degrades to "unavailable" instead of guessing.

begin;

do $$ begin
  if to_regprocedure('public.vt_pbf_check_item(uuid,jsonb)') is null then raise exception '268: apply sql/267 first'; end if;
  if to_regclass('public.pin_capture_evidence') is null then raise exception '268: pin_capture_evidence missing'; end if;
  if to_regclass('public.trips') is null then raise exception '268: trips missing'; end if;
end $$;

-- ---------- helpers ----------
create or replace function public.vt_pbf_metres(a_lat double precision, a_lon double precision, b_lat double precision, b_lon double precision)
returns double precision language sql immutable set search_path = public as $$
  select sqrt(power((b_lon - a_lon) * 111320 * cos(radians(a_lat)), 2) + power((b_lat - a_lat) * 110574, 2));
$$;
create or replace function public.vt_pbf_bearing(a_lat double precision, a_lon double precision, b_lat double precision, b_lon double precision)
returns double precision language sql immutable set search_path = public as $$
  select mod((degrees(atan2((b_lon - a_lon) * 111320 * cos(radians(a_lat)), (b_lat - a_lat) * 110574)) + 360)::numeric, 360)::double precision;
$$;
create or replace function public.vt_pbf_angle_diff(a double precision, b double precision)
returns double precision language sql immutable set search_path = public as $$
  select abs(mod((mod((a - b)::numeric, 360) + 540)::numeric, 360) - 180)::double precision;
$$;
create or replace function public.vt_pbf_norm_side(v text) returns text language sql immutable set search_path = public as $$
  select case when lower(btrim(coalesce(v,''))) like 'l%' then 'left' when lower(btrim(coalesce(v,''))) like 'r%' then 'right' end;
$$;

-- Travel from GPS course observations: ≥2 samples, each with time, course, speed ≥0.8 m/s, accuracy ≤5 m;
-- span ≤15 s; course spread ≤20°; displacement ≥2 m and within 30° of mean course.
create or replace function public.vt_pbf_travel_obs(p_obs jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare q record; n int := 0; total int := 0; t0 timestamptz; t1 timestamptz; sx double precision := 0; cx double precision := 0;
  mean double precision; spread double precision := 0; f record; l record; disp double precision; db double precision;
begin
  if p_obs is null or jsonb_typeof(p_obs) <> 'array' then return jsonb_build_object('ok',false,'available',false,'reason','no observation array'); end if;
  total := jsonb_array_length(p_obs);
  create temp table if not exists _pbf_obs(t timestamptz, lat double precision, lon double precision, c double precision) on commit drop;
  delete from _pbf_obs;
  insert into _pbf_obs
    select (o->>'observedAt')::timestamptz, (o->>'latitude')::double precision, (o->>'longitude')::double precision, (o->>'courseDegrees')::double precision
      from jsonb_array_elements(p_obs) o
     where o->>'observedAt' is not null and o->>'latitude' is not null and o->>'longitude' is not null
       and coalesce((o->>'courseDegrees')::double precision,-1) >= 0
       and coalesce((o->>'speedMps')::double precision,0) >= 0.8
       and coalesce((o->>'horizontalAccuracyM')::double precision, 999) <= 5;
  select count(*), min(t), max(t) into n, t0, t1 from _pbf_obs;
  if n < 2 then return jsonb_build_object('ok',false,'available',true,'samples',total,'qualified',n,'reason',n||' qualified course sample(s); need ≥2'); end if;
  if extract(epoch from t1 - t0) > 15 then return jsonb_build_object('ok',false,'available',true,'qualified',n,'reason','qualified samples span > 15 s'); end if;
  select sum(sin(radians(c))), sum(cos(radians(c))) into sx, cx from _pbf_obs;
  mean := mod((degrees(atan2(sx, cx)) + 360)::numeric, 360);
  select max(public.vt_pbf_angle_diff(c, mean)) into spread from _pbf_obs;
  if spread > 20 then return jsonb_build_object('ok',false,'available',true,'qualified',n,'reason','conflicting courses (spread '||round(spread::numeric)||'°)'); end if;
  select * into f from _pbf_obs order by t limit 1; select * into l from _pbf_obs order by t desc limit 1;
  disp := public.vt_pbf_metres(f.lat, f.lon, l.lat, l.lon);
  if disp < 2 then return jsonb_build_object('ok',false,'available',true,'qualified',n,'reason','stationary: displacement '||round(disp::numeric,1)||' m'); end if;
  db := public.vt_pbf_bearing(f.lat, f.lon, l.lat, l.lon);
  if public.vt_pbf_angle_diff(db, mean) > 30 then return jsonb_build_object('ok',false,'available',true,'qualified',n,'reason','displacement disagrees with reported course'); end if;
  return jsonb_build_object('ok',true,'available',true,'source','gps_observations','course_deg',mean,'qualified',n,'displacement_m',disp,'spread_deg',spread);
end $$;

-- Travel from ordered trip path around a UNIQUE exact anchor (|Δ| < 1e-7°): walk ≥5 m each way,
-- chord/path ≥0.9, no reversal (>150° turn at anchor).
create or replace function public.vt_pbf_travel_track(p_lat double precision, p_lon double precision, p_path jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare n int; idx int[] := '{}'; i int; j int; k int; pt record; a record; b record; c record;
  path_b double precision := 0; path_f double precision := 0; ib int; jf int; chord double precision; brg1 double precision; brg2 double precision;
begin
  if p_path is null or jsonb_typeof(p_path) <> 'array' then return jsonb_build_object('ok',false,'anchor','unavailable','reason','no ordered track'); end if;
  n := jsonb_array_length(p_path);
  for i in 0..n-1 loop
    select * into pt from public.vt_pbf_pt(p_path->i);
    if pt.lat is not null and abs(pt.lat - p_lat) < 1e-7 and abs(pt.lon - p_lon) < 1e-7 then idx := idx || i; end if;
  end loop;
  if cardinality(idx) = 0 then return jsonb_build_object('ok',false,'anchor','none','reason','no exact track coordinate'); end if;
  if cardinality(idx) > 1 then return jsonb_build_object('ok',false,'anchor','multiple','matches',cardinality(idx),'reason','anchor repeats in track'); end if;
  i := idx[1]; select * into c from public.vt_pbf_pt(p_path->i);
  j := i; ib := null;
  while j > 0 loop
    select * into a from public.vt_pbf_pt(p_path->(j-1)); select * into b from public.vt_pbf_pt(p_path->j);
    path_b := path_b + public.vt_pbf_metres(a.lat,a.lon,b.lat,b.lon); j := j - 1;
    if public.vt_pbf_metres(c.lat,c.lon,a.lat,a.lon) >= 5 then ib := j; exit; end if;
  end loop;
  k := i; jf := null;
  while k < n - 1 loop
    select * into a from public.vt_pbf_pt(p_path->k); select * into b from public.vt_pbf_pt(p_path->(k+1));
    path_f := path_f + public.vt_pbf_metres(a.lat,a.lon,b.lat,b.lon); k := k + 1;
    if public.vt_pbf_metres(c.lat,c.lon,b.lat,b.lon) >= 5 then jf := k; exit; end if;
  end loop;
  if ib is null or jf is null then return jsonb_build_object('ok',false,'anchor','unique','reason','stationary or short: < 5 m of track each side of anchor'); end if;
  select * into a from public.vt_pbf_pt(p_path->ib); select * into b from public.vt_pbf_pt(p_path->jf);
  brg1 := public.vt_pbf_bearing(a.lat,a.lon,c.lat,c.lon); brg2 := public.vt_pbf_bearing(c.lat,c.lon,b.lat,b.lon);
  if public.vt_pbf_angle_diff(brg1, brg2) > 150 then return jsonb_build_object('ok',false,'anchor','unique','reason','track reverses at anchor'); end if;
  chord := public.vt_pbf_metres(a.lat,a.lon,b.lat,b.lon);
  if chord / nullif(path_b + path_f,0) < 0.9 then return jsonb_build_object('ok',false,'anchor','unique','reason','track not straight around anchor','straightness',chord/nullif(path_b+path_f,0)); end if;
  return jsonb_build_object('ok',true,'anchor','unique','source','trip_track','course_deg',public.vt_pbf_bearing(a.lat,a.lon,b.lat,b.lon),
    'chord_m',chord,'straightness',chord/nullif(path_b+path_f,0),'anchor_index',i);
end $$;

-- Bounding rows / aisle for a point (no row choice). Returns row axis and signed offsets.
create or replace function public.vt_pbf_bounding(p_lat double precision, p_lon double precision, p_rows jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare kx double precision := 111320 * cos(radians(p_lat)); ky double precision := 110574; r jsonb; s record; e record;
  dx double precision; dy double precision; px double precision; py double precision; len double precision; t double precision; sd double precision;
  acc jsonb := '[]'::jsonb; lo jsonb; hi jsonb; axes double precision[] := '{}'; ax0 double precision; maxdev double precision := 0; a double precision;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return jsonb_build_object('ok',false,'reason','no rows'); end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select * into s from public.vt_pbf_pt(coalesce(r->'startPoint', r->'start'));
    select * into e from public.vt_pbf_pt(coalesce(r->'endPoint', r->'end'));
    continue when (r->>'number') is null or s.lat is null or e.lat is null;
    dx := (e.lon - s.lon) * kx; dy := (e.lat - s.lat) * ky; len := sqrt(dx*dx + dy*dy); continue when len < 1;
    if ax0 is null then ax0 := degrees(atan2(dx, dy)); end if;
    -- orient all rows like the first so signed offsets are comparable
    if cos(radians(degrees(atan2(dx, dy)) - ax0)) < 0 then dx := -dx; dy := -dy; s := e; end if;
    px := (p_lon - s.lon) * kx; py := (p_lat - s.lat) * ky;
    t := (px*dx + py*dy) / (len*len); sd := (px*dy - py*dx) / len; -- >0 = point is right of row (axis-relative)
    a := degrees(atan2(dx, dy)); maxdev := greatest(maxdev, public.vt_pbf_angle_diff(a, ax0));
    acc := acc || jsonb_build_object('n',(r->>'number')::int,'off',sd,'t',t,'d',abs(sd),
      'fx', (p_lon - s.lon) * kx - px + t*dx, 'fy', t*dy - py);
  end loop;
  select x into lo from jsonb_array_elements(acc) x where (x->>'off')::double precision >= 0 order by (x->>'off')::double precision limit 1;
  select x into hi from jsonb_array_elements(acc) x where (x->>'off')::double precision < 0 order by (x->>'off')::double precision desc limit 1;
  if lo is null or hi is null then return jsonb_build_object('ok',false,'reason','outside outermost rows','row_axis_deg',ax0); end if;
  return jsonb_build_object('ok',true,'row_axis_deg',mod((ax0+360)::numeric,360),'row_divergence_deg',maxdev,
    'row_a',(lo->>'n')::int,'dist_a_m',(lo->>'d')::double precision,'t_a',(lo->>'t')::double precision,
    'row_b',(hi->>'n')::int,'dist_b_m',(hi->>'d')::double precision,'t_b',(hi->>'t')::double precision,
    'spacing_m',(lo->>'d')::double precision + (hi->>'d')::double precision,
    'aisle',((lo->>'n')::int + (hi->>'n')::int)::numeric / 2);
end $$;

-- ---------- per-pin reconstruction (read-only) ----------
create or replace function public.vt_pbf_reconstruct_pin(p_pin uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p record; pj jsonb; ev record; evj jsonb; pad record; padj jsonb; trip_path jsonb; trip_id uuid;
  gps jsonb; trv jsonb; tobs jsonb; ttrk jsonb; sides text[]; side_src jsonb := '{}'::jsonb; side text; side_c jsonb;
  blk jsonb; geo jsonb; bnd jsonb; dev double precision; acc double precision; course double precision; hold text[] := '{}';
  tier text; chosen int; vx double precision; cross double precision; proj jsonb; captured timestamptz; v_poly_ids uuid[]; v_block uuid; block_src text;
  combo text;
begin
  select * into p from public.pins where id = p_pin; if not found then return null; end if;
  pj := to_jsonb(p);
  select * into ev from public.pin_capture_evidence e where e.pin_id = p_pin order by e.captured_at desc nulls last limit 1;
  evj := case when ev is null then null else to_jsonb(ev) end;
  captured := coalesce((evj->>'captured_at')::timestamptz, (pj->>'created_at')::timestamptz);
  acc := (evj->>'horizontal_accuracy_m')::double precision;

  -- 1. GPS
  gps := jsonb_build_object('available', p.latitude is not null and p.longitude is not null,
    'raw_latitude',p.latitude,'raw_longitude',p.longitude,'captured_at',captured,
    'captured_at_source', case when evj->>'captured_at' is not null then 'pin_capture_evidence.captured_at' when pj->>'created_at' is not null then 'pins.created_at' else 'unavailable' end,
    'horizontal_accuracy_m',acc,'accuracy_source', case when acc is null then 'unavailable' else 'pin_capture_evidence.horizontal_accuracy_m' end,
    'saved_snapped_latitude',p.snapped_latitude,'saved_snapped_longitude',p.snapped_longitude,'saved_snapped_to_row',p.snapped_to_row,
    'observation_count', case when jsonb_typeof(evj->'observations')='array' then jsonb_array_length(evj->'observations') else 0 end);

  -- 2. TRAVEL (device heading is comparison only)
  tobs := public.vt_pbf_travel_obs(evj->'observations');
  trip_id := nullif(pj->>'trip_id','')::uuid;
  if trip_id is not null then select to_jsonb(t)->'path_points' into trip_path from public.trips t where t.id = trip_id; end if;
  ttrk := case when trip_id is null then jsonb_build_object('ok',false,'anchor','no_trip','reason','no linked trip')
               else public.vt_pbf_travel_track(p.latitude, p.longitude, trip_path) end;
  if (tobs->>'ok')::boolean and (ttrk->>'ok')::boolean then
    if public.vt_pbf_angle_diff((tobs->>'course_deg')::double precision, (ttrk->>'course_deg')::double precision) > 30 then
      trv := jsonb_build_object('ok',false,'reason','GPS course and track direction conflict','conflict',true);
    else trv := jsonb_build_object('ok',true,'source','gps_observations+trip_track','course_deg',(ttrk->>'course_deg')::double precision); end if;
  elsif (tobs->>'ok')::boolean then trv := jsonb_build_object('ok',true,'source','gps_observations','course_deg',(tobs->>'course_deg')::double precision);
  elsif (ttrk->>'ok')::boolean then trv := jsonb_build_object('ok',true,'source','trip_track','course_deg',(ttrk->>'course_deg')::double precision);
  else trv := jsonb_build_object('ok',false,'reason','no qualified travel evidence'); end if;
  dev := coalesce((evj->>'heading_degrees')::double precision, (pj->>'heading')::double precision);
  trv := trv || jsonb_build_object('observations',tobs,'track',ttrk,'device_heading_deg',dev,
    'device_heading_source', case when evj->>'heading_degrees' is not null then 'pin_capture_evidence.heading_degrees' when pj->>'heading' is not null then 'pins.heading' else 'unavailable' end,
    'device_heading_used', false,
    'device_heading_vs_travel_deg', case when (trv->>'ok')::boolean and dev is not null then public.vt_pbf_angle_diff(dev,(trv->>'course_deg')::double precision) end);
  course := case when (trv->>'ok')::boolean then (trv->>'course_deg')::double precision end;

  -- 3. LEFT / RIGHT (stored values only)
  if public.vt_pbf_norm_side(p.pin_side) is not null then side_src := side_src || jsonb_build_object('pins.pin_side', public.vt_pbf_norm_side(p.pin_side)); end if;
  if public.vt_pbf_norm_side(pj->>'side') is not null then side_src := side_src || jsonb_build_object('pins.side', public.vt_pbf_norm_side(pj->>'side')); end if;
  if public.vt_pbf_norm_side(evj->>'pressed_side') is not null then side_src := side_src || jsonb_build_object('pin_capture_evidence.pressed_side', public.vt_pbf_norm_side(evj->>'pressed_side')); end if;
  select array_agg(distinct v) into sides from jsonb_each_text(side_src) x(k, v);
  side := case when cardinality(sides) = 1 then sides[1] end;
  side_c := jsonb_build_object('available', side_src <> '{}'::jsonb, 'value', side, 'sources', side_src,
    'conflict', coalesce(cardinality(sides),0) > 1, 'inferred', false);

  -- block
  if p.paddock_id is not null then v_block := p.paddock_id; block_src := 'saved';
  else
    select array_agg(id) into v_poly_ids from public.paddocks d where d.vineyard_id = p.vineyard_id and d.deleted_at is null
      and public.vt_pbf_point_in_polygon(p.latitude, p.longitude, d.polygon_points::jsonb) is true;
    if cardinality(v_poly_ids) = 1 then v_block := v_poly_ids[1]; block_src := 'polygon_suggestion'; else block_src := 'none'; end if;
  end if;
  if v_block is not null then select * into pad from public.paddocks where id = v_block; padj := to_jsonb(pad); end if;
  blk := jsonb_build_object('paddock_id',v_block,'source',block_src,'candidates',coalesce(cardinality(v_poly_ids),0));

  -- geometry (current; historical is not stored in the live schema — flagged when block changed after capture)
  if v_block is not null and p.latitude is not null then
    bnd := public.vt_pbf_bounding(p.latitude, p.longitude, pad.rows::jsonb);
    geo := jsonb_build_object('geometry_source','current_only','historical_geometry','unavailable',
      'geometry_identity', public.vt_pbf_geometry_identity(pad.polygon_points::jsonb, pad.rows::jsonb),
      'capture_geometry_hash', evj->>'geometry_hash',
      'block_updated_after_capture', (padj->>'updated_at')::timestamptz > captured,
      'inside_polygon', public.vt_pbf_point_in_polygon(p.latitude, p.longitude, pad.polygon_points::jsonb),
      'bounding', bnd);
  end if;

  combo := 'gps' || case when dev is not null then '+device_heading' else '' end || case when side_src <> '{}'::jsonb then '+side' else '' end;

  -- tiering
  if p.row_number is not null or p.pin_row_number is not null or p.driving_row_number is not null
     or coalesce(p.location_scope,'') = 'row' or exists (select 1 from public.pin_row_segments s where s.pin_id = p.id) then tier := 'preserved';
  elsif exists (select 1 from public.pin_row_backfill_audit a where a.pin_id = p.id and a.decision_source = 'manual_field_check') then tier := 'field_confirmed';
  elsif v_block is null then tier := 'missing_block';
  elsif (side_c->>'conflict')::boolean or side is null then tier := 'missing_side';
    if (side_c->>'conflict')::boolean then hold := hold || 'side sources conflict'; else hold := hold || 'no recorded Left/Right — field confirmation required'; end if;
  elsif course is null then tier := 'missing_direction'; hold := hold || coalesce(trv->>'reason','no travel');
  else
    if block_src <> 'saved' then hold := hold || 'block is a polygon suggestion, not saved'; end if;
    if (geo->>'inside_polygon')::boolean is distinct from true then hold := hold || 'raw GPS outside block polygon'; end if;
    if coalesce((geo->>'block_updated_after_capture')::boolean, false) then hold := hold || 'block geometry changed after capture (historical geometry unavailable)'; end if;
    if not coalesce((bnd->>'ok')::boolean,false) then hold := hold || coalesce(bnd->>'reason','no bounding rows');
    else
      if (bnd->>'row_divergence_deg')::double precision > 10 then hold := hold || 'rows diverge (contour) — straight-row model unsafe'; end if;
      if least((bnd->>'t_a')::double precision,(bnd->>'t_b')::double precision) < 0.05 or greatest((bnd->>'t_a')::double precision,(bnd->>'t_b')::double precision) > 0.95 then hold := hold || 'headland / row end'; end if;
      if acc is null then hold := hold || 'GPS accuracy unknown';
      elsif acc >= least((bnd->>'dist_a_m')::double precision,(bnd->>'dist_b_m')::double precision) then hold := hold || 'GPS accuracy circle crosses a bounding row (aisle ambiguous)'; end if;
      vx := public.vt_pbf_angle_diff(course, (bnd->>'row_axis_deg')::double precision);
      if least(vx, 180 - vx) > 30 then hold := hold || 'travel not along rows';
      else
        -- row_a is on the axis-right of the point; travel along axis → row_a is on the LEFT of the traveller.
        if (vx <= 90) = (side = 'left') then chosen := (bnd->>'row_a')::int; else chosen := (bnd->>'row_b')::int; end if;
      end if;
    end if;
    if (trv->>'device_heading_vs_travel_deg')::double precision > 30 then
      trv := trv || jsonb_build_object('device_heading_note','device heading disagrees with travel; ignored'); end if;
    tier := case when cardinality(hold) = 0 and chosen is not null then 'technically_supported' else 'needs_review' end;
  end if;

  if tier = 'technically_supported' then proj := public.vt_pbf_project(p.latitude, p.longitude, pad.rows::jsonb, chosen);
    if not coalesce((proj->>'ok')::boolean,false) then tier := 'needs_review'; hold := hold || ('projection: '||coalesce(proj->>'reason','failed')); end if;
  end if;

  return jsonb_build_object('algorithm_version','pbf-recon-v1','pin_id',p.id,'tier',tier,'combination',combo,
    'gps',gps,'travel',trv,'side',side_c,'block',blk,'geometry',geo,'holds',hold,
    'suggestion', jsonb_build_object('derived',true,'authoritative',false,
      'bounding_rows', case when (bnd->>'ok')::boolean then jsonb_build_array((bnd->>'row_a')::int,(bnd->>'row_b')::int) end,
      'driving_aisle', bnd->'aisle',
      'vine_row', case when tier in ('technically_supported','needs_review') then chosen end,
      'snap', case when tier = 'technically_supported' and p.snapped_latitude is null and p.snapped_longitude is null
                   then jsonb_build_object('latitude',proj->'snapped_latitude','longitude',proj->'snapped_longitude') end),
    'source_fields_immutable', true,
    'sync_version', p.sync_version, 'updated_at', p.updated_at);
end $$;
revoke all on function public.vt_pbf_reconstruct_pin(uuid) from public, anon, authenticated;

-- Report: one row per missing pin + per-combination / tier counts. Read-only.
create or replace function public.pin_row_reconstruction_report(p_vineyard uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb := '[]'::jsonb; r jsonb; pid uuid; assigned int;
begin
  if not public.vt_pbf_authorized(p_vineyard) then raise exception 'not authorised' using errcode = '42501'; end if;
  for pid in select id from public.pins where vineyard_id = p_vineyard and deleted_at is null and latitude is not null and longitude is not null
                and row_number is null and pin_row_number is null order by id loop
    res := res || public.vt_pbf_reconstruct_pin(pid);
  end loop;
  select count(*) into assigned from public.pins where vineyard_id = p_vineyard and deleted_at is null and latitude is not null
    and (row_number is not null or pin_row_number is not null);
  return jsonb_build_object('algorithm_version','pbf-recon-v1','generated_at',now(),'read_only',true,
    'missing_total', jsonb_array_length(res), 'already_assigned_preserved', assigned,
    'by_combination', (select coalesce(jsonb_object_agg(k, n),'{}') from (select x->>'combination' k, count(*) n from jsonb_array_elements(res) x group by 1) q),
    'by_tier', (select coalesce(jsonb_object_agg(k, n),'{}') from (select x->>'tier' k, count(*) n from jsonb_array_elements(res) x group by 1) q),
    'by_combination_tier', (select coalesce(jsonb_object_agg(k, n),'{}') from (select (x->>'combination')||'|'||(x->>'tier') k, count(*) n from jsonb_array_elements(res) x group by 1) q),
    'pins', res);
end $$;
revoke all on function public.pin_row_reconstruction_report(uuid) from public, anon;
grant execute on function public.pin_row_reconstruction_report(uuid) to authenticated;

-- ---------- 267 gate: wrap the existing item check ----------
alter function public.vt_pbf_check_item(uuid, jsonb) rename to vt_pbf_check_item_base;

create or replace function public.vt_pbf_check_item(p_vineyard uuid, it jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare base jsonb; rc jsonb; fails text[]; src text := it->>'source'; fc jsonb := it->'field_confirmation'; rhash text;
begin
  base := public.vt_pbf_check_item_base(p_vineyard, it);
  rc := public.vt_pbf_reconstruct_pin((it->>'pin_id')::uuid);
  if rc is null then return base; end if;
  select coalesce(array_agg(x),'{}') into fails from jsonb_array_elements_text(base->'fails') x;
  rhash := encode(sha256(convert_to((rc - 'sync_version' - 'updated_at')::text,'UTF8')),'hex');
  if src in ('measured','reviewed_track') then
    if rc->>'tier' <> 'technically_supported' then
      fails := fails || ('REVIEW-BYPASS: server reconstruction is '||(rc->>'tier')||' — needs server-supported travel+side+geometry or manual_field_check');
    else
      if (rc->'suggestion'->>'vine_row')::int is distinct from (it->>'pin_row_number')::int then fails := fails || 'row differs from server reconstruction'; end if;
      if nullif(it->>'driving_row_number','') is not null and (rc->'suggestion'->>'driving_aisle')::numeric <> (it->>'driving_row_number')::numeric then fails := fails || 'aisle differs from server reconstruction'; end if;
      if nullif(it->>'pin_side','') is not null and lower(it->>'pin_side') <> rc->'side'->>'value' then fails := fails || 'side differs from recorded side'; end if;
    end if;
  elsif src = 'manual_field_check' then
    if fc is null or jsonb_typeof(fc) <> 'object' or coalesce(btrim(fc->>'observed_by'),'') = '' or (fc->>'observed_at') is null
       or coalesce(btrim(fc->>'method'),'') = '' or coalesce(btrim(fc->>'note'),'') = '' then
      fails := fails || 'manual_field_check requires recorded field_confirmation {observed_by, observed_at, method, note}';
    end if;
  end if;
  if it ? 'expected_reconstruction_hash' and it->>'expected_reconstruction_hash' <> rhash then fails := fails || 'server reconstruction changed since approval'; end if;
  return base || jsonb_build_object('ok', cardinality(fails) = 0, 'fails', fails,
    'outcome', case when cardinality(fails) > 0 then 'blocked' else base->>'outcome' end,
    'projection', coalesce(base->'projection','{}'::jsonb) || jsonb_build_object('reconstruction', rc),
    'reconstruction_hash', rhash, 'algorithm_version', 'pbf-recon-v1');
end $$;
revoke all on function public.vt_pbf_check_item(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.vt_pbf_check_item_base(uuid, jsonb) from public, anon, authenticated;

-- Approval now also freezes the server reconstruction hash.
create or replace function public.pin_row_backfill_create_approval(p_vineyard uuid, p_items jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare dr jsonb; frozen jsonb := '[]'::jsonb; it jsonb; chk jsonb; v_id uuid; v_hash text;
begin
  dr := public.pin_row_backfill_dry_run(p_vineyard, p_items);
  if (dr->>'blocked')::int > 0 then raise exception 'dry-run has % blocked item(s); approval refused', dr->>'blocked'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    chk := public.vt_pbf_check_item(p_vineyard, it);
    frozen := frozen || (it || jsonb_build_object('expected_geometry_identity', chk->>'geometry_identity',
                                                  'expected_reconstruction_hash', chk->>'reconstruction_hash'));
  end loop;
  v_hash := encode(sha256(convert_to(frozen::text,'UTF8')),'hex');
  insert into public.pin_row_backfill_approvals(vineyard_id, items, items_hash, item_count, dry_run, created_by)
    values (p_vineyard, frozen, v_hash, jsonb_array_length(frozen), dr, auth.uid()) returning id into v_id;
  return jsonb_build_object('approval_id',v_id,'items_hash',v_hash,'item_count',jsonb_array_length(frozen),
    'confirm_phrase', 'APPLY ' || jsonb_array_length(frozen) || ' PIN ROWS');
end $$;

revoke all on function public.vt_pbf_travel_obs(jsonb) from public, anon;
revoke all on function public.vt_pbf_travel_track(double precision, double precision, jsonb) from public, anon;
revoke all on function public.vt_pbf_bounding(double precision, double precision, jsonb) from public, anon;

commit;
