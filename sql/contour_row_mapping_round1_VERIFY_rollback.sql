-- Contour Row Mapping — ROLLBACK-ONLY verification for the pending migration.
-- Run AFTER applying sql/contour_row_mapping_round1_applied.sql inside a
-- transaction on the shared VineTrack database, as a role able to SET ROLE
-- authenticated (e.g. postgres in the SQL editor). Everything is rolled back.
--
-- Fill in the four ids below with real rows before running:
--   :admin_member   active System Admin who owns or is a member of :vineyard
--   :member_only    vineyard member who is NOT a System Admin
--   :admin_outsider active System Admin with NO ownership/membership of :vineyard
--   :paddock        a live (deleted_at is null) block in :vineyard
-- Each check RAISEs on failure; success prints NOTICE lines and ROLLBACKs.

begin;

create temp table _v(k text primary key, v uuid) on commit drop;
insert into _v values
  ('admin_member',   '00000000-0000-0000-0000-000000000001'),  -- REPLACE
  ('member_only',    '00000000-0000-0000-0000-000000000002'),  -- REPLACE
  ('admin_outsider', '00000000-0000-0000-0000-000000000003'),  -- REPLACE
  ('paddock',        '00000000-0000-0000-0000-000000000004');  -- REPLACE
grant select on _v to authenticated;

create temp table _paddock_before on commit drop as
  select md5(row(p.*)::text) as h from public.paddocks p where p.id = (select v from _v where k = 'paddock');

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
end $$;

create or replace function pg_temp.payload(d uuid, g uuid, r uuid, pt uuid, num int) returns jsonb language sql as $$
  select jsonb_build_object('schema','vinetrack.contour_row_mapping_draft','version',1,'draftId',d,
    'vineyardId',(select vineyard_id from public.paddocks where id=(select v from _v where k='paddock')),
    'paddockId',(select v from _v where k='paddock'),
    'groups', jsonb_build_array(jsonb_build_object('id',g,'name','G','mode','contour','referenceTrace','[]'::jsonb,
      'smoothing',0,'spacingM',2.5,'startNumber',1,'ascending',true,'leftCount',0,'rightCount',0,'extendToArea',true,
      'workingArea',null,'exclusions','[]'::jsonb,
      'rows', jsonb_build_array(jsonb_build_object('id',r,'number',num,'offsetIndex',0,'provenance','generated','canonicalRowId',null,'source',null,
        'parts', jsonb_build_array(jsonb_build_object('id',pt,'points', jsonb_build_array(
          jsonb_build_object('lat',-34.5,'lng',138.7), jsonb_build_object('lat',-34.5001,'lng',138.7001)))))))))
$$;

create or replace function pg_temp.expect_error(sql text, pattern text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if sqlerrm ~ pattern then raise notice 'ok: % -> %', left(sql, 60), sqlerrm; return; end if;
    raise exception 'unexpected error for %: % (wanted %)', sql, sqlerrm, pattern;
  end;
  raise exception 'expected error % for %', pattern, sql;
end $$;

do $$
declare
  pk uuid := (select v from _v where k='paddock');
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid();
  a jsonb; p1 jsonb; p2 jsonb;
begin
  set local role authenticated;

  -- Denials
  perform pg_temp.as_user((select v from _v where k='member_only'));
  perform pg_temp.expect_error(format('select public.get_contour_row_mapping_draft(%L)', pk), 'not_authorised');
  perform pg_temp.as_user((select v from _v where k='admin_outsider'));
  perform pg_temp.expect_error(format('select public.get_contour_row_mapping_draft(%L)', pk), 'not_authorised');
  perform pg_temp.as_user(null);
  perform pg_temp.expect_error(format('select public.get_contour_row_mapping_draft(%L)', pk), 'not_authorised');
  perform pg_temp.expect_error('select * from vt_contour_private.drafts', 'permission denied');

  -- Acceptance
  perform pg_temp.as_user((select v from _v where k='admin_member'));
  if public.get_contour_row_mapping_draft(pk) is not null then raise notice 'note: existing draft present for this block'; end if;
  p1 := pg_temp.payload(d1, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1);
  a := public.save_contour_row_mapping_draft(pk, null, 0, s1, p1);
  if (a->>'revision')::int <> 1 or (a->>'client_save_id')::uuid <> s1 then raise exception 'initial save ack wrong: %', a; end if;

  -- Initial race contract: a second "first save" (expected null/0) must be stale.
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, null, 0, %L, %L::jsonb)', pk, gen_random_uuid(), pg_temp.payload(d2, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1)), 'stale_revision');

  -- Idempotent replay: same id + same content returns original ack; different content is rejected.
  a := public.save_contour_row_mapping_draft(pk, null, 0, s1, p1);
  if (a->>'replayed')::boolean is not true or (a->>'revision')::int <> 1 then raise exception 'replay not idempotent: %', a; end if;
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, null, 0, %L, %L::jsonb)', pk, s1, jsonb_set(p1, '{groups,0,name}', '"Other"')), 'invalid_client_save_id_reused');

  -- Null/negative inputs
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, null, %L, %L::jsonb)', pk, d1, gen_random_uuid(), p1), 'invalid_expected_revision');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, -1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), p1), 'invalid_expected_revision');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, null, %L::jsonb)', pk, d1, p1), 'invalid_client_save_id');

  -- Malformed payloads
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), p1 - 'schema'), 'invalid_schema_version');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), p1 - 'paddockId'), 'invalid_identity');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), p1 - 'groups'), 'invalid_groups');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), jsonb_set(p1, '{groups,0,rows,0,number}', '0')), 'invalid_row_number');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), jsonb_set(p1, '{groups,0,rows,0,number}', '1.5')), 'invalid_row_number');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), jsonb_set(p1, '{groups,0,rows,0,id}', 'null')), 'invalid_row');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), jsonb_set(p1, '{groups,0,rows,0,parts}', '[]')), 'invalid_row_parts');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), jsonb_set(p1, '{groups,0,rows,0,parts,0,points,1}', '{"lat":-34.5,"lng":138.7}')), 'invalid_zero_length_part');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), jsonb_set(p1, '{groups,0,rows,0,parts,0,points,0,lat}', 'null')), 'invalid_row_part');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), jsonb_set(p1, '{groups,0,rows,0,parts,0,points,0,lng}', '200')), 'invalid_row_part');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), jsonb_set(p1, '{groups,0,workingArea}', '[{"lat":1,"lng":1}]')), 'invalid_working_area');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), jsonb_set(p1, '{groups,0,spacingM}', '0')), 'invalid_group_settings');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), jsonb_set(p1, '{groups,0,rows,0,canonicalRowId}', to_jsonb(gen_random_uuid()::text))), 'invalid_canonical_row_not_in_block');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), jsonb_set(p1, '{groups,0,rows,0,parts,0,id}', to_jsonb(d1::text))), 'invalid_duplicate_id');

  -- Normal second save, then stale save with old revision.
  a := public.save_contour_row_mapping_draft(pk, d1, 1, s2, jsonb_set(p1, '{groups,0,name}', '"Rev2"'));
  if (a->>'revision')::int <> 2 then raise exception 'second save wrong: %', a; end if;
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 1, %L, %L::jsonb)', pk, d1, gen_random_uuid(), p1), 'stale_revision');

  -- Discard: stale revision rejected; correct discard; idempotent repeat.
  perform pg_temp.expect_error(format('select public.discard_contour_row_mapping_draft(%L, %L, 1)', pk, d1), 'stale_revision');
  a := public.discard_contour_row_mapping_draft(pk, d1, 2);
  if (a->>'revision')::int <> 3 or (a->>'already_discarded')::boolean then raise exception 'discard wrong: %', a; end if;
  a := public.discard_contour_row_mapping_draft(pk, d1, 2);
  if not (a->>'already_discarded')::boolean then raise exception 'discard not idempotent: %', a; end if;

  -- Recreate after discard: revision continues (no reset to 1).
  p2 := pg_temp.payload(d2, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1);
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, null, 0, %L, %L::jsonb)', pk, gen_random_uuid(), p2), 'stale_revision');
  a := public.save_contour_row_mapping_draft(pk, null, 3, gen_random_uuid(), p2);
  if (a->>'revision')::int <> 4 then raise exception 'recreate wrong: %', a; end if;

  -- Delayed stale save/discard of the OLD draft must not touch the replacement.
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, %L, 2, %L, %L::jsonb)', pk, d1, gen_random_uuid(), p1), 'stale_draft_discarded');
  perform pg_temp.expect_error(format('select public.save_contour_row_mapping_draft(%L, null, 3, %L, %L::jsonb)', pk, gen_random_uuid(), p1), 'stale_draft_discarded');
  a := public.discard_contour_row_mapping_draft(pk, d1, 2);
  if not (a->>'already_discarded')::boolean then raise exception 'old discard touched replacement: %', a; end if;
  if (public.get_contour_row_mapping_draft(pk)->>'draft_id')::uuid <> d2 then raise exception 'replacement draft lost'; end if;

  reset role;
  if (select h from _paddock_before) <> (select md5(row(p.*)::text) from public.paddocks p where p.id = pk) then
    raise exception 'paddocks row changed'; end if;
  raise notice 'ALL CONTOUR DRAFT CHECKS PASSED';
end $$;

rollback;
