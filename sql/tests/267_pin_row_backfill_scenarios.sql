-- Scenarios: geometry = 5 N-S rows 2.8 m apart at lat -34; pin 7 m east of row 1 (between rows 3 & 4, 1.4 m from each).
\set ON_ERROR_STOP 0
\set VY '''fe952afe-437f-4be7-8cbf-fdd8e630411c'''
insert into system_admins values ('00000000-0000-0000-0000-00000000000a');
insert into vineyard_members values (:VY,'00000000-0000-0000-0000-00000000000a','owner'),
  (:VY,'00000000-0000-0000-0000-00000000000b','manager'),(:VY,'00000000-0000-0000-0000-00000000000c','worker');
insert into system_admins values ('00000000-0000-0000-0000-00000000000c');
with k as (select 1/(111320*cos(radians(-34))) m)
insert into paddocks select '00000000-0000-0000-0000-0000000000b1', :VY,
  jsonb_build_array(jsonb_build_object('latitude',-34.0001,'longitude',150-m), jsonb_build_object('latitude',-34.0001,'longitude',150+12*m),
    jsonb_build_object('latitude',-33.9989,'longitude',150+12*m), jsonb_build_object('latitude',-33.9989,'longitude',150-m)),
  (select jsonb_agg(jsonb_build_object('number',n,'startPoint',jsonb_build_object('latitude',-34,'longitude',150+(n-1)*2.8*m),
     'endPoint',jsonb_build_object('latitude',-33.999,'longitude',150+(n-1)*2.8*m))) from generate_series(1,5) n), null from k;
with k as (select 1/(111320*cos(radians(-34))) m)
insert into pins(id,vineyard_id,paddock_id,latitude,longitude,pin_side) select ('00000000-0000-0000-0000-0000000000'||lpad(i::text,2,'0'))::uuid,
  :VY,'00000000-0000-0000-0000-0000000000b1',-33.9995,150+7*m,'Right' from k, generate_series(1,6) i;
update pins set driving_row_number=3.5 where id='00000000-0000-0000-0000-000000000002';
insert into pin_row_segments values ('00000000-0000-0000-0000-000000000003',4,1);
update pins set snapped_latitude=-33.9995, snapped_longitude=150.0001 where id='00000000-0000-0000-0000-000000000004';
create temp table items as select jsonb_build_object('pin_id',id,'paddock_id',paddock_id,'pin_row_number',4,'driving_row_number',3.5,
  'pin_side','right','source','reviewed_track','reason','owner reviewed','expected_sync_version','1',
  'expected_updated_at','2026-10-14T00:00:00Z','expected_latitude',latitude,'expected_longitude',longitude) j, id from pins;

\echo == anon / nonmember / worker denied
select set_config('test.uid','',false); select public.pin_row_backfill_dry_run(:VY, (select jsonb_agg(j) from items where id::text like '%01'));
select set_config('test.uid','00000000-0000-0000-0000-00000000000c',false); select public.pin_row_backfill_dry_run(:VY, (select jsonb_agg(j) from items where id::text like '%01'));
select set_config('test.uid','00000000-0000-0000-0000-00000000000b',false); select public.pin_row_backfill_dry_run(:VY, (select jsonb_agg(j) from items where id::text like '%01'));
\echo == other vineyard denied
select set_config('test.uid','00000000-0000-0000-0000-00000000000a',false);
select public.pin_row_backfill_dry_run('11111111-1111-1111-1111-111111111111', (select jsonb_agg(j) from items where id::text like '%01'));
\echo == dry run all (expect 01 snapped, 02/03 preserved blocked, 04 unsnapped keep snap, 05 side contradiction, 06 wrong row)
select jsonb_pretty(x) from jsonb_array_elements((public.pin_row_backfill_dry_run(:VY,
  (select jsonb_agg(case when id::text like '%05' then j||'{"pin_side":"left"}' when id::text like '%06' then j||'{"pin_row_number":2,"driving_row_number":2.5}' else j end) from items)))->'items') x;
\echo == approval refused when any blocked
select public.pin_row_backfill_create_approval(:VY, (select jsonb_agg(j) from items));
\echo == approval + apply for 01 and 04
select public.pin_row_backfill_create_approval(:VY, (select jsonb_agg(j) from items where id::text like '%01' or id::text like '%04')) as ap \gset
select :'ap'::jsonb->>'approval_id' as aid, :'ap'::jsonb->>'items_hash' as h \gset
\echo -- wrong phrase
select public.pin_row_backfill_apply(:'aid', :'h', 'APPLY 9 PIN ROWS');
\echo -- wrong hash
select public.pin_row_backfill_apply(:'aid', 'x', 'APPLY 2 PIN ROWS');
\echo -- CAS change blocks everything
update pins set sync_version=2 where id='00000000-0000-0000-0000-000000000004';
select public.pin_row_backfill_apply(:'aid', :'h', 'APPLY 2 PIN ROWS');
select id, pin_row_number, sync_version from pins where id::text like '%01';
update pins set sync_version=1 where id='00000000-0000-0000-0000-000000000004';
\echo -- good apply
select jsonb_pretty(public.pin_row_backfill_apply(:'aid', :'h', 'APPLY 2 PIN ROWS'));
\echo -- idempotent rerun
select (public.pin_row_backfill_apply(:'aid', :'h', 'APPLY 2 PIN ROWS'))->>'idempotent';
select id, latitude, longitude, pin_row_number, driving_row_number, pin_side, snapped_latitude, snapped_longitude, snapped_to_row, sync_version from pins order by id;
\echo -- audit immutable
select count(*) from pin_row_backfill_audit; update pin_row_backfill_audit set reason='x'; delete from pin_row_backfill_audit;
\echo -- missing count
select count(*) from pins where row_number is null and pin_row_number is null;
