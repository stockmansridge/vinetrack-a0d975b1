-- Additional source-only safety regressions; all fixtures are synthetic, not live validation.
\set ON_ERROR_STOP 1
\set VY '''fe952afe-437f-4be7-8cbf-fdd8e630411c'''
begin;
update trips set path_points=pg_temp.track(-33.9995,(select 150+7*m from k),array[-12,-8,-4,0,4,8,12])
 where id='00000000-0000-0000-0000-0000000000c2';
select pg_temp.eq('validation restored without fitting offsets',(vt_pbf_validation(:VY)->>'passed')::boolean,true);
update pins set pin_row_number=4 where id::text like '10000000-0000-0000-0001-%';
select pg_temp.eq('one known-row mismatch blocks validation',(vt_pbf_validation(:VY)->>'passed')::boolean,false);
select pg_temp.eq('known-row mismatch counted',(vt_pbf_validation(:VY)->>'mismatches')::int,1);
select pg_temp.eq('report supported batch empty after validation failure',pin_row_reconstruction_report(:VY)->'supported_batch','[]'::jsonb);
select pg_temp.eq('report never creates approved batch',pin_row_reconstruction_report(:VY)->'approved_batch','null'::jsonb);
rollback;

begin;
-- Live audit pattern reproduced only to prove fail-closed behavior, NOT asserted as a live result.
delete from pins where id::text like '10000000%';
insert into pins(id,vineyard_id,paddock_id,latitude,longitude,pin_row_number,driving_row_number,pin_side,trip_id,created_at)
 select ('20000000-0000-0000-'||lpad(i::text,4,'0')||'-ffffffffffff')::uuid,:VY,
 '00000000-0000-0000-0000-0000000000b1',-33.9995,150+7*m,case when i<=12 then 3 else 4 end,3.5,'Left',
 '00000000-0000-0000-0000-0000000000c2','2026-05-31' from k,generate_series(1,31) i;
update trips set path_points=pg_temp.track(-33.9995,(select 150+7*m from k),array[-12,-8,-4,0,4,8,12])
 where id='00000000-0000-0000-0000-0000000000c2';
insert into pin_capture_evidence(pin_id,captured_at,horizontal_accuracy_m,geometry_hash)
 select id,'2026-05-31',1,'not-capture-history' from pins where id::text like '20000000%';
select pg_temp.eq('31 May pins have unique anchors',(vt_pbf_validation(:VY)->>'cohort_size')::int,31);
select pg_temp.eq('31 May pins unavailable before September history',(vt_pbf_validation(:VY)->>'unavailable')::int,31);
select pg_temp.eq('May cohort must not be called validated',(vt_pbf_validation(:VY)->>'passed')::boolean,false);
select pg_temp.eq('no May current-map automatic batch',pin_row_reconstruction_report(:VY)->'supported_batch','[]'::jsonb);
rollback;

begin;
select pg_temp.eq('canonical capture identity read',vt_pbf_reconstruct_pin('00000000-0000-0000-0000-000000000009')->'geometry'->>'geometry_source','capture_time_history');
update pin_capture_evidence set geometry_hash='tampered' where pin_id::text like '%09';
select pg_temp.eq('capture hash mismatch is held',exists(select 1 from jsonb_array_elements_text(vt_pbf_reconstruct_pin('00000000-0000-0000-0000-000000000009')->'holds') h where h like 'capture evidence hash differs%'),true);
update pin_capture_evidence set geometry_hash=null where pin_id::text like '%09';
select pg_temp.eq('absent capture hash held',exists(select 1 from jsonb_array_elements_text(vt_pbf_reconstruct_pin('00000000-0000-0000-0000-000000000009')->'holds') h where h='capture geometry hash missing'),true);
insert into pin_location_geometry_history(paddock_id,vineyard_id,valid_from,polygon_points,rows)
 select id,vineyard_id,'2026-09-12',polygon_points,rows from paddocks;
select pg_temp.eq('overlapping history fails closed',(vt_pbf_reconstruct_pin('00000000-0000-0000-0000-000000000009')->'geometry'->>'matching_intervals')::int,2);
rollback;

begin;
-- North axis reversed at row endpoints must not reverse physical numbering.
select pg_temp.eq('rowNumber/start/end format projects row 4',
 (vt_pbf_project(-33.9995,(select 150+7*m from k),(select jsonb_agg(jsonb_build_object('rowNumber',r->'number','start',r->'endPoint','end',r->'startPoint')) from paddocks,jsonb_array_elements(rows) r),4)->>'aisle')::numeric,3.5);
select pg_temp.eq('southbound course reversal is preserved',round((vt_pbf_travel_track(-33.9995,(select 150+7*m from k),pg_temp.track(-33.9995,(select 150+7*m from k),array[12,8,4,0,-4,-8,-12]))->>'course_deg')::numeric),180::numeric);
select pg_temp.eq('malformed observations hold',(vt_pbf_travel_obs('[{"observedAt":"oops","latitude":-34,"longitude":150,"courseDegrees":0,"speedMps":1,"horizontalAccuracyM":1}]')->>'ok')::boolean,false);
select pg_temp.eq('malformed tracks hold',(vt_pbf_travel_track(-34,150,'[{"latitude":"bad","longitude":150}]')->>'ok')::boolean,false);
update pin_location_geometry_history set valid_to='2026-10-01';
select pg_temp.eq('valid_to exclusive; current map never substituted',(vt_pbf_reconstruct_pin('00000000-0000-0000-0000-000000000009')->'geometry'->>'matching_intervals')::int,0);
rollback;

begin;
-- Security checks run under actual client role privileges as well as auth.uid.
select pg_temp.eq('no client internal reconstruction execution',has_function_privilege('authenticated','public.vt_pbf_reconstruct_pin(uuid)','EXECUTE'),false);
select pg_temp.eq('no client base check execution',has_function_privilege('authenticated','public.vt_pbf_check_item_base(uuid,jsonb)','EXECUTE'),false);
select pg_temp.eq('no client pin writes granted',has_table_privilege('authenticated','public.pins','UPDATE'),false);
insert into trips(id,vineyard_id,path_points) values('30000000-0000-0000-0000-000000000001','ffffffff-ffff-ffff-ffff-ffffffffffff',pg_temp.track(-33.9995,(select 150+7*m from k),array[-12,-6,0,6,12]));
update pins set trip_id='30000000-0000-0000-0000-000000000001' where id::text like '%02';
select pg_temp.eq('cross-vineyard linked trip is unavailable',vt_pbf_reconstruct_pin('00000000-0000-0000-0000-000000000002')->'travel'->'track'->>'anchor','unavailable');
set local role authenticated;
select set_config('test.uid','',true);
do $$ begin
 perform pin_row_reconstruction_report('fe952afe-437f-4be7-8cbf-fdd8e630411c');
 raise exception 'FAIL signed-out report accepted';
exception when insufficient_privilege then raise notice 'ok  signed-out report denied'; end $$;
reset role;
select set_config('test.uid','00000000-0000-0000-0000-00000000000a',true);
do $$ begin
 perform pin_row_reconstruction_report('ffffffff-ffff-ffff-ffff-ffffffffffff');
 raise exception 'FAIL other vineyard report accepted';
exception when insufficient_privilege then raise notice 'ok  other vineyard report denied'; end $$;
rollback;
\echo ALL CAPTURE HISTORY TESTS PASSED