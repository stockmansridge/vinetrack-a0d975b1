-- Local tests for sql/268 (NOT for production). Run after 267 harness + 267 + 268 + 268 harness extras.
-- Every check raises on failure (ON_ERROR_STOP). Geometry: 5 N-S rows 2.8 m apart (rows run south→north).
\set ON_ERROR_STOP 1
\set VY '''fe952afe-437f-4be7-8cbf-fdd8e630411c'''
create or replace function pg_temp.eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin if got is distinct from want then raise exception 'FAIL %: got %, want %', label, got, want; end if; raise notice 'ok  %', label; end $$;

insert into system_admins values ('00000000-0000-0000-0000-00000000000a');
insert into vineyard_members values (:VY,'00000000-0000-0000-0000-00000000000a','owner');
select set_config('test.uid','00000000-0000-0000-0000-00000000000a',false);
create temp table k as select 1/(111320*cos(radians(-34))) m, 1/110574.0 n;
insert into paddocks(id,vineyard_id,polygon_points,rows,deleted_at,updated_at) select '00000000-0000-0000-0000-0000000000b1', :VY,
  jsonb_build_array(jsonb_build_object('latitude',-34.0001,'longitude',150-m), jsonb_build_object('latitude',-34.0001,'longitude',150+12*m),
    jsonb_build_object('latitude',-33.9989,'longitude',150+12*m), jsonb_build_object('latitude',-33.9989,'longitude',150-m)),
  (select jsonb_agg(jsonb_build_object('number',r,'startPoint',jsonb_build_object('latitude',-34,'longitude',150+(r-1)*2.8*m),
     'endPoint',jsonb_build_object('latitude',-33.999,'longitude',150+(r-1)*2.8*m))) from generate_series(1,5) r), null, '2026-06-01T00:00:00Z' from k;

insert into pin_location_geometry_history(paddock_id,vineyard_id,valid_from,valid_to,polygon_points,rows,geometry_hash)
 select id,vineyard_id,'2026-09-12',null,polygon_points,rows,'legacy-history-hash' from paddocks;
-- ===== 1. live input matrix 71 / 6 / 4 / 38 (no travel evidence) =====
begin;
insert into pins(id,vineyard_id,paddock_id,latitude,longitude,heading,pin_side)
select gen_random_uuid(), :VY, '00000000-0000-0000-0000-0000000000b1', -33.9995, 150+7*m,
  case when i <= 77 then 10 end, case when i <= 71 or i > 115 then 'Right' end from k, generate_series(1,119) i;
-- i 1..71 heading+side, 72..77 heading only, 116..119 side only, 78..115 GPS only (38)
select pin_row_reconstruction_report(:VY) as r \gset
select pg_temp.eq('matrix total', (:'r'::jsonb->>'missing_total')::int, 119);
select pg_temp.eq('gps+device_heading+side', (:'r'::jsonb->'by_combination'->>'gps+device_heading+side')::int, 71);
select pg_temp.eq('gps+device_heading', (:'r'::jsonb->'by_combination'->>'gps+device_heading')::int, 6);
select pg_temp.eq('gps+side', (:'r'::jsonb->'by_combination'->>'gps+side')::int, 4);
select pg_temp.eq('gps only', (:'r'::jsonb->'by_combination'->>'gps')::int, 38);
select pg_temp.eq('44 lacking side held', (:'r'::jsonb->'by_tier'->>'missing_side')::int, 44);
select pg_temp.eq('75 with side but no travel', (:'r'::jsonb->'by_tier'->>'missing_direction')::int, 75);
select pg_temp.eq('device heading never promotes', (:'r'::jsonb->'by_tier'->>'technically_supported'), null::text);
rollback;

-- ===== 2. scenario pins =====
-- helper to build north-moving observations at the pin
create or replace function pg_temp.obs(lat float8, lon float8, course float8, speed float8, acc float8) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('latitude', lat + (i-2)*1.5/110574.0, 'longitude', lon, 'observedAt', ('2026-10-01T00:00:0'||(i*2)||'Z'),
    'courseDegrees', course, 'speedMps', speed, 'horizontalAccuracyM', acc)) from generate_series(1,3) i $$;
create or replace function pg_temp.track(lat float8, lon float8, pts float8[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('bearing',0,'accuracy',1,'speed',1.2,'latitude', case when d = 0 then lat else lat + d/110574.0 end, 'longitude', lon) order by o)
    from unnest(pts) with ordinality u(d, o) $$;
insert into trips(id,path_points) select '00000000-0000-0000-0000-0000000000c2', pg_temp.track(-33.9995,150+7*m, array[-12,-8,-4,0,4,8,12]) from k;      -- straight north, unique
insert into trips(id,path_points) select '00000000-0000-0000-0000-0000000000c3', pg_temp.track(-33.9995,150+7*m, array[-8,0,8,12,0,-8]) from k;         -- anchor twice
insert into trips(id,path_points) select '00000000-0000-0000-0000-0000000000c4', pg_temp.track(-33.9995,150+7*m, array[-0.5,-0.2,0,0.2,0.5]) from k;    -- stationary
insert into trips(id,path_points) select '00000000-0000-0000-0000-0000000000c5', pg_temp.track(-33.9995,150+7*m, array[-12,-6,0,-6,-12]) from k;         -- reverses

insert into pins(id,vineyard_id,paddock_id,latitude,longitude,heading,pin_side,trip_id,snapped_latitude,snapped_longitude,driving_row_number)
select ('00000000-0000-0000-0000-0000000000'||lpad(i::text,2,'0'))::uuid, :VY,
  case when i = 8 then null else '00000000-0000-0000-0000-0000000000b1'::uuid end,
  case when i = 8 then -33.99 else -33.9995 end, 150+7*m,
  case when i in (1,3,7) then 80 end,                                     -- phone heading 80° (P1 travel 0° → 80° off)
  case when i in (1,3,6,9,10,11) then 'Right' when i = 2 then 'Left' end,
  case i when 2 then '00000000-0000-0000-0000-0000000000c2' when 3 then '00000000-0000-0000-0000-0000000000c3'
         when 4 then '00000000-0000-0000-0000-0000000000c4' when 5 then '00000000-0000-0000-0000-0000000000c5' end::uuid,
  case when i = 11 then -33.99951 end, case when i = 11 then 150.00006 end,
  case when i = 12 then 3.5 end
from k, generate_series(1,12) i;
update trips set vineyard_id=:VY;
update pins set pin_side='Left' where id::text like '%05' or id::text like '%04';
insert into pin_capture_evidence(pin_id,captured_at,horizontal_accuracy_m,heading_degrees,pressed_side,observations,geometry_hash)
select id, case when id::text like '%10' then '2026-01-01T00:00:00Z' else '2026-10-01T00:00:00Z' end::timestamptz,
  case when id::text like '%09' then 3.0 else 1.0 end, null,
  case when id::text like '%06' then 'left' end,
  case when id::text ~ '(01|06|09|10|11)$' then pg_temp.obs(latitude, longitude, 0, 1.2, 2) end, (select public.pin_geometry_identity(polygon_points,rows) from paddocks limit 1)
from pins;

create temp table rc as select id, vt_pbf_reconstruct_pin(id) r from pins;
select pg_temp.eq('P1 obs travel + side → supported', (select r->>'tier' from rc where id::text like '%01'), 'technically_supported');
select pg_temp.eq('P1 right going north = row 4', (select (r->'suggestion'->>'vine_row')::int from rc where id::text like '%01'), 4);
select pg_temp.eq('P1 bounding rows 3/4', (select r->'suggestion'->'bounding_rows' from rc where id::text like '%01'), '[3,4]'::jsonb);
select pg_temp.eq('P1 aisle 3.5', (select (r->'suggestion'->>'driving_aisle')::numeric from rc where id::text like '%01'), 3.5);
select pg_temp.eq('P1 phone heading 80° off is not used', (select (r->'travel'->>'device_heading_used')::boolean from rc where id::text like '%01'), false);
select pg_temp.eq('P1 heading disagreement logged', (select round((r->'travel'->>'device_heading_vs_travel_deg')::numeric) from rc where id::text like '%01'), 80::numeric);
select pg_temp.eq('P1 versioned', (select r->>'algorithm_version' from rc where id::text like '%01'), 'pbf-recon-v2');
select pg_temp.eq('P2 unique track anchor', (select r->'travel'->'track'->>'anchor' from rc where id::text like '%02'), 'unique');
select pg_temp.eq('P2 left going north = row 3', (select (r->'suggestion'->>'vine_row')::int from rc where id::text like '%02'), 3);
select pg_temp.eq('P2 track source', (select r->'travel'->>'source' from rc where id::text like '%02'), 'trip_track');
select pg_temp.eq('P3 multiple anchors', (select r->'travel'->'track'->>'anchor' from rc where id::text like '%03'), 'multiple');
select pg_temp.eq('P3 missing_direction', (select r->>'tier' from rc where id::text like '%03'), 'missing_direction');
select pg_temp.eq('P4 stationary', (select r->>'tier' from rc where id::text like '%04'), 'missing_direction');
select pg_temp.eq('P5 reversing', (select r->'travel'->'track'->>'reason' from rc where id::text like '%05'), 'track reverses at anchor');
select pg_temp.eq('P6 side conflict', (select (r->'side'->>'conflict')::boolean from rc where id::text like '%06'), true);
select pg_temp.eq('P6 hold', (select r->>'tier' from rc where id::text like '%06'), 'missing_side');
select pg_temp.eq('P7 missing side never inferred', (select r->>'tier' from rc where id::text like '%07'), 'missing_side');
select pg_temp.eq('P7 no vine row', (select r->'suggestion'->>'vine_row' from rc where id::text like '%07'), null::text);
select pg_temp.eq('P8 missing block', (select r->>'tier' from rc where id::text like '%08'), 'missing_block');
select pg_temp.eq('P9 3 m accuracy crosses 2.8 m aisle', (select r->>'tier' from rc where id::text like '%09'), 'needs_review');
select pg_temp.eq('P10 geometry changed after capture', (select r->>'tier' from rc where id::text like '%10'), 'needs_review');
select pg_temp.eq('P10 historical geometry unavailable before September', (select r->'geometry'->>'historical_geometry' from rc where id::text like '%10'), 'unavailable');
select pg_temp.eq('P11 supported, no new snap', (select r->'suggestion'->>'snap' from rc where id::text like '%11'), null::text);
select pg_temp.eq('P12 preserved', (select r->>'tier' from rc where id::text like '%12'), 'preserved');
select pg_temp.eq('P1 provenance accuracy', (select r->'gps'->>'accuracy_source' from rc where id::text like '%01'), 'pin_capture_evidence.horizontal_accuracy_m');
select pg_temp.eq('P1 side provenance', (select r->'side'->'sources'->>'pins.pin_side' from rc where id::text like '%01'), 'right');

-- Schema-shaped known-row holdout: deterministic IDs, already assigned, no writes by reconstruction.
insert into pins(id,vineyard_id,paddock_id,latitude,longitude,pin_row_number,driving_row_number,pin_side,trip_id)
 select ('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,:VY,
 '00000000-0000-0000-0000-0000000000b1',-33.9995,150+7*m,3::numeric,3.5,'Left','00000000-0000-0000-0000-0000000000c2'
 from k,generate_series(1,20) i;
insert into pin_capture_evidence(pin_id,captured_at,horizontal_accuracy_m,geometry_hash)
 select id,'2026-10-01',1,(select pin_geometry_identity(polygon_points,rows) from paddocks limit 1)
 from pins where id::text like '10000000%';
select pg_temp.eq('held-out known-row validation passes', (vt_pbf_validation(:VY)->>'passed')::boolean,true);
select pg_temp.eq('held-out count', (vt_pbf_validation(:VY)->>'held_out_count')::int,10);

-- ===== 3. dry-run gate =====
create temp table it as select id, jsonb_build_object('pin_id',id,'paddock_id',paddock_id,'pin_row_number',4,'driving_row_number',3.5,
  'pin_side','right','source','reviewed_track','reason','server supported','expected_sync_version',sync_version::text,
  'expected_updated_at',updated_at,'expected_latitude',latitude,'expected_longitude',longitude) j from pins;
create temp table before as select md5(string_agg(to_jsonb(p)::text, '' order by id)) h from pins p;
select pin_row_backfill_dry_run(:VY, (select jsonb_agg(case when id::text like '%02' then j||'{"pin_row_number":3,"driving_row_number":3.5,"pin_side":"left"}' else j end) from it where id::text ~ '(01|02|07|09)$')) as d \gset
select pg_temp.eq('dry-run ok count', (:'d'::jsonb->>'ok')::int, 2);
select pg_temp.eq('P7 reviewed_track bypass rejected', exists(select 1 from jsonb_array_elements(:'d'::jsonb->'items') x, jsonb_array_elements_text(x->'fails') f
  where x->>'pin_id' like '%07' and f like 'REVIEW-BYPASS%'), true);
select pg_temp.eq('P9 needs_review bypass rejected', (select (x->>'ok')::boolean from jsonb_array_elements(:'d'::jsonb->'items') x where x->>'pin_id' like '%09'), false);
select pg_temp.eq('dry-run wrote nothing', (select md5(string_agg(to_jsonb(p)::text, '' order by id)) from pins p), (select h from before));
select pin_row_backfill_dry_run(:VY, (select jsonb_agg(j||'{"pin_row_number":3,"driving_row_number":2.5}') from it where id::text like '%01')) as d2 \gset
select pg_temp.eq('client row differing from server rejected', (:'d2'::jsonb->>'blocked')::int, 1);
select pin_row_backfill_dry_run(:VY, (select jsonb_agg(j||'{"source":"manual_field_check","pin_side":"left","pin_row_number":3}') from it where id::text like '%07')) as d3 \gset
select pg_temp.eq('manual without field record rejected', (:'d3'::jsonb->>'blocked')::int, 1);
select pin_row_backfill_dry_run(:VY, (select jsonb_agg(j||'{"source":"manual_field_check","pin_side":"left","pin_row_number":3,"field_confirmation":{"observed_by":"JH","observed_at":"2026-10-19","method":"walked row","note":"tag on post"}}') from it where id::text like '%07')) as d4 \gset
select pg_temp.eq('manual with recorded field confirmation ok', (:'d4'::jsonb->>'ok')::int, 1);

-- ===== 4. approval / apply / idempotence / provenance =====
select pin_row_backfill_create_approval(:VY, (select jsonb_agg(j) from it where id::text ~ '(01|11)$')) as ap \gset
select :'ap'::jsonb->>'approval_id' aid, :'ap'::jsonb->>'items_hash' h \gset
select pg_temp.eq('approval froze recon hash', (select count(*) from pin_row_backfill_approvals a, jsonb_array_elements(a.items) x where a.id=:'aid' and x ? 'expected_reconstruction_hash')::int, 2);
select pin_row_backfill_apply(:'aid', :'h', 'APPLY 2 PIN ROWS') as rcpt \gset
select pg_temp.eq('P1 snapped', (select snapped_to_row from pins where id::text like '%01'), true);
select pg_temp.eq('P1 sync_version bumped', (select sync_version from pins where id::text like '%01'), 2);
select pg_temp.eq('P1 raw lat preserved', (select latitude from pins where id::text like '%01'), -33.9995::float8);
select pg_temp.eq('P11 original snap preserved', (select snapped_latitude from pins where id::text like '%11'), -33.99951::float8);
select pg_temp.eq('P11 outcome unsnapped', (select outcome from pin_row_backfill_audit where pin_id::text like '%11'), 'assigned_unsnapped');
select pg_temp.eq('audit carries reconstruction', (select projection->'reconstruction'->>'algorithm_version' from pin_row_backfill_audit where pin_id::text like '%01'), 'pbf-recon-v2');
select pg_temp.eq('idempotent rerun', (pin_row_backfill_apply(:'aid', :'h', 'APPLY 2 PIN ROWS')->>'idempotent')::boolean, true);
select pg_temp.eq('no double bump', (select sync_version from pins where id::text like '%01'), 2);
select pg_temp.eq('applied pin now preserved', (vt_pbf_reconstruct_pin('00000000-0000-0000-0000-000000000001')->>'tier'), 'preserved');

-- reconstruction drift after approval blocks apply
select pin_row_backfill_create_approval(:VY, (select jsonb_agg(j||'{"pin_row_number":3,"pin_side":"left"}') from it where id::text like '%02')) as ap2 \gset
select :'ap2'::jsonb->>'approval_id' aid2, :'ap2'::jsonb->>'items_hash' h2 \gset
update trips set path_points = pg_temp.track(-33.9995,(select 150+7*m from k), array[-12,-6,0,-6,-12]) where id='00000000-0000-0000-0000-0000000000c2';
do $$ begin
  perform pin_row_backfill_apply((select id from pin_row_backfill_approvals where status='pending_owner' order by created_at desc limit 1),
    (select items_hash from pin_row_backfill_approvals where status='pending_owner' order by created_at desc limit 1), 'APPLY 1 PIN ROWS');
  raise exception 'FAIL drift apply should have been blocked';
exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok  drift blocks apply: %', left(sqlerrm, 90); end $$;
select pg_temp.eq('P2 untouched after blocked apply', (select pin_row_number from pins where id::text like '%02'), null::numeric);
\echo ALL 268 TESTS PASSED
