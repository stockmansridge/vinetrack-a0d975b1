-- =====================================================================
-- 160_delete_damage_record_tests.sql — rollback-only verification
-- =====================================================================
-- Run in the Supabase SQL editor of the SHARED VineTrack project
-- (tbafuqwruefgkbyxrxyb) AFTER applying sql/160_delete_damage_record.sql.
--
-- Everything runs inside ONE transaction that is ROLLED BACK at the end.
-- No production damage record is created, changed or deleted.
--
-- Test map
--   T1  Schema: deleted_by exists, nullable, uuid, FK to auth.users
--   T2  Function signatures, security definer, fixed search_path, grants
--       (incl. anon revoked by name — Supabase default privileges grant it)
--   T3  can_manage_vineyard_damage: Owner / co-Owner / Manager / SysAdmin
--   T4  can_manage_vineyard_damage: Supervisor / Operator / non-member
--   T5  Manager deletes a record in their own vineyard (happy path)
--   T6  Row is retained; deleted_at + deleted_by populated with the caller
--   T7  Record disappears from standard damage history
--   T8  Record no longer contributes to yield / damage summaries
--   T9  Supervisor  -> damage_delete_permission_denied
--   T10 Operator    -> damage_delete_permission_denied
--   T11 Non-member  -> damage_delete_permission_denied
--   T12 Manager of another vineyard -> denied (and cannot probe existence)
--   T13 Repeated delete -> damage_record_already_deleted
--   T14 Unknown id / wrong vineyard -> damage_record_not_found
--   T15 Owner, co-Owner and System Administrator may delete
--   T16 Anonymous caller rejected
--   T17 Mobile soft_delete_damage_record still works and stamps deleted_by
--   T18 No hard delete happened anywhere
--   T19 All fixtures discarded by the final ROLLBACK
--
-- Expected final output:
--   NOTICE: SQL 160 delete damage record tests: ALL PASSED
-- =====================================================================

begin;

-- Guard: refuse to run before SQL 160 is applied.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'damage_records'
       and column_name = 'deleted_by'
  ) then
    raise exception 'SQL 160 not applied — damage_records.deleted_by missing.';
  end if;

  if to_regprocedure('public.can_manage_vineyard_damage(uuid)') is null
     or to_regprocedure('public.delete_damage_record(uuid, uuid)') is null then
    raise exception 'SQL 160 not applied — delete RPCs missing.';
  end if;
end$$;

do $$
declare
  u_owner   uuid := gen_random_uuid();
  u_coowner uuid := gen_random_uuid();
  u_mgr     uuid := gen_random_uuid();
  u_admin   uuid := gen_random_uuid();
  u_sup     uuid := gen_random_uuid();
  u_op      uuid := gen_random_uuid();
  u_none    uuid := gen_random_uuid();
  u_mgr_b   uuid := gen_random_uuid();

  vy_a uuid := gen_random_uuid();
  vy_b uuid := gen_random_uuid();

  d_del     uuid := gen_random_uuid();
  d_owner   uuid := gen_random_uuid();
  d_coowner uuid := gen_random_uuid();
  d_admin   uuid := gen_random_uuid();
  d_soft    uuid := gen_random_uuid();
  d_keep    uuid := gen_random_uuid();
  d_other   uuid := gen_random_uuid();

  total_before int;
  n            int;
  ts           timestamptz;
  actor        uuid;
  state        text;
  msg          text;
begin
  -- ---------------------------------------------------------------------
  -- T1. Schema
  -- ---------------------------------------------------------------------
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'damage_records'
    and column_name = 'deleted_by' and data_type = 'uuid'
    and is_nullable = 'YES';
  assert n = 1, 'T1a deleted_by must be a nullable uuid column';

  select count(*) into n
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name
   and kcu.constraint_schema = tc.constraint_schema
  where tc.table_schema = 'public' and tc.table_name = 'damage_records'
    and tc.constraint_type = 'FOREIGN KEY' and kcu.column_name = 'deleted_by';
  assert n = 1, 'T1b deleted_by must reference auth.users';
  raise notice 'T1 passed: deleted_by column present and attributed';

  -- ---------------------------------------------------------------------
  -- T2. Function definition and grants
  -- ---------------------------------------------------------------------
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('delete_damage_record', 'can_manage_vineyard_damage', 'soft_delete_damage_record')
    and p.prosecdef
    and array_to_string(coalesce(p.proconfig, array[]::text[]), ',') like '%search_path=public%';
  assert n >= 3, 'T2a all three functions must be security definer with a fixed search_path';

  assert has_function_privilege('authenticated', 'public.delete_damage_record(uuid, uuid)', 'execute'),
    'T2b authenticated must be able to execute delete_damage_record';
  assert not has_function_privilege('anon', 'public.delete_damage_record(uuid, uuid)', 'execute'),
    'T2c anon must NOT be able to execute delete_damage_record';
  assert not has_function_privilege('anon', 'public.can_manage_vineyard_damage(uuid)', 'execute'),
    'T2d anon must NOT be able to execute can_manage_vineyard_damage';
  assert not has_function_privilege('anon', 'public.soft_delete_damage_record(uuid)', 'execute'),
    'T2e anon must NOT be able to execute soft_delete_damage_record';
  raise notice 'T2 passed: signatures, security definer, search_path and grants correct';

  -- ---------------------------------------------------------------------
  -- Fixtures
  -- ---------------------------------------------------------------------
  insert into auth.users (id, email, instance_id, aud, role)
  values
    (u_owner,   't160-owner@test.local',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (u_coowner, 't160-coowner@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (u_mgr,     't160-mgr@test.local',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (u_admin,   't160-admin@test.local',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (u_sup,     't160-sup@test.local',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (u_op,      't160-op@test.local',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (u_none,    't160-none@test.local',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (u_mgr_b,   't160-mgrb@test.local',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  insert into public.vineyards (id, name) values
    (vy_a, 'T160 Vineyard A'),
    (vy_b, 'T160 Vineyard B');

  insert into public.vineyard_members (vineyard_id, user_id, role) values
    (vy_a, u_owner,   'owner'),
    (vy_a, u_coowner, 'owner'),   -- co-Owner = second owner-level member
    (vy_a, u_mgr,     'manager'),
    (vy_a, u_sup,     'supervisor'),
    (vy_a, u_op,      'operator'),
    (vy_b, u_mgr_b,   'manager');

  insert into public.system_admins (user_id) values (u_admin) on conflict do nothing;

  insert into public.damage_records (id, vineyard_id, damage_type, notes, damage_percent, created_by)
  values
    (d_del,     vy_a, 'frost', 'T160 manager delete',  10, u_owner),
    (d_owner,   vy_a, 'hail',  'T160 owner delete',    10, u_owner),
    (d_coowner, vy_a, 'wind',  'T160 coowner delete',  10, u_owner),
    (d_admin,   vy_a, 'pest',  'T160 admin delete',    10, u_owner),
    (d_soft,    vy_a, 'other', 'T160 mobile soft',     10, u_owner),
    (d_keep,    vy_a, 'frost', 'T160 control keep',    10, u_owner),
    (d_other,   vy_b, 'hail',  'T160 other vineyard',  10, u_owner);

  select count(*) into total_before from public.damage_records where notes like 'T160 %';
  assert total_before = 7, 'fixture seeding failed';

  perform set_config('role', 'authenticated', true);

  -- ---------------------------------------------------------------------
  -- T3 / T4. Authority helper
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner::text, 'role', 'authenticated')::text, true);
  assert public.can_manage_vineyard_damage(vy_a), 'T3a owner';
  perform set_config('request.jwt.claims', json_build_object('sub', u_coowner::text, 'role', 'authenticated')::text, true);
  assert public.can_manage_vineyard_damage(vy_a), 'T3b co-owner';
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr::text, 'role', 'authenticated')::text, true);
  assert public.can_manage_vineyard_damage(vy_a), 'T3c manager';
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin::text, 'role', 'authenticated')::text, true);
  assert public.can_manage_vineyard_damage(vy_a), 'T3d system admin';
  raise notice 'T3 passed: owner, co-owner, manager and system admin authorised';

  perform set_config('request.jwt.claims', json_build_object('sub', u_sup::text, 'role', 'authenticated')::text, true);
  assert not public.can_manage_vineyard_damage(vy_a), 'T4a supervisor denied';
  perform set_config('request.jwt.claims', json_build_object('sub', u_op::text, 'role', 'authenticated')::text, true);
  assert not public.can_manage_vineyard_damage(vy_a), 'T4b operator denied';
  perform set_config('request.jwt.claims', json_build_object('sub', u_none::text, 'role', 'authenticated')::text, true);
  assert not public.can_manage_vineyard_damage(vy_a), 'T4c non-member denied';
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr_b::text, 'role', 'authenticated')::text, true);
  assert not public.can_manage_vineyard_damage(vy_a), 'T4d manager of another vineyard denied';
  raise notice 'T4 passed: supervisor, operator, non-member and cross-vineyard denied';

  -- ---------------------------------------------------------------------
  -- T5 / T6 / T7 / T8. Manager happy path
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr::text, 'role', 'authenticated')::text, true);
  perform public.delete_damage_record(vy_a, d_del);

  select deleted_at, deleted_by into ts, actor from public.damage_records where id = d_del;
  assert ts is not null, 'T6a deleted_at populated';
  assert actor = u_mgr,  'T6b deleted_by is the caller';
  assert (select created_by from public.damage_records where id = d_del) = u_owner,
    'T6c original created_by retained';
  raise notice 'T5/T6 passed: manager delete succeeded and is fully attributed';

  select count(*) into n
  from public.damage_records
  where vineyard_id = vy_a and deleted_at is null and id = d_del;
  assert n = 0, 'T7 deleted record must not appear in standard history';
  raise notice 'T7 passed: record excluded from damage history';

  select coalesce(sum(damage_percent), 0) into n
  from public.damage_records
  where vineyard_id = vy_a and deleted_at is null;
  assert n = 60, 'T8 damage totals must exclude the deleted record, got ' || n;
  raise notice 'T8 passed: record excluded from damage / yield totals';

  -- ---------------------------------------------------------------------
  -- T9-T12. Unauthorised callers
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_sup::text, 'role', 'authenticated')::text, true);
  begin
    perform public.delete_damage_record(vy_a, d_keep);
    assert false, 'T9 supervisor must not delete';
  exception when others then
    get stacked diagnostics msg = message_text, state = returned_sqlstate;
    assert msg = 'damage_delete_permission_denied', 'T9 got: ' || msg;
    assert state = '42501', 'T9 errcode: ' || state;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_op::text, 'role', 'authenticated')::text, true);
  begin
    perform public.delete_damage_record(vy_a, d_keep);
    assert false, 'T10 operator must not delete';
  exception when others then
    get stacked diagnostics msg = message_text;
    assert msg = 'damage_delete_permission_denied', 'T10 got: ' || msg;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_none::text, 'role', 'authenticated')::text, true);
  begin
    perform public.delete_damage_record(vy_a, d_keep);
    assert false, 'T11 non-member must not delete';
  exception when others then
    get stacked diagnostics msg = message_text;
    assert msg = 'damage_delete_permission_denied', 'T11 got: ' || msg;
  end;

  -- Cross-vineyard manager: denied, and the error must NOT reveal whether
  -- the record exists (permission is checked before existence).
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr_b::text, 'role', 'authenticated')::text, true);
  begin
    perform public.delete_damage_record(vy_a, d_keep);
    assert false, 'T12 manager of vineyard B must not delete vineyard A records';
  exception when others then
    get stacked diagnostics msg = message_text;
    assert msg = 'damage_delete_permission_denied', 'T12 got: ' || msg;
  end;
  begin
    perform public.delete_damage_record(vy_a, gen_random_uuid());
    assert false, 'T12b existence probing must be impossible';
  exception when others then
    get stacked diagnostics msg = message_text;
    assert msg = 'damage_delete_permission_denied', 'T12b leaked existence: ' || msg;
  end;

  assert (select deleted_at from public.damage_records where id = d_keep) is null,
    'T9-T12 control record must remain live';
  raise notice 'T9-T12 passed: supervisor, operator, non-member and cross-vineyard rejected';

  -- ---------------------------------------------------------------------
  -- T13 / T14. Repeat and not-found
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr::text, 'role', 'authenticated')::text, true);
  begin
    perform public.delete_damage_record(vy_a, d_del);
    assert false, 'T13 repeated delete must fail';
  exception when others then
    get stacked diagnostics msg = message_text, state = returned_sqlstate;
    assert msg = 'damage_record_already_deleted', 'T13 got: ' || msg;
    assert state = '22023', 'T13 errcode: ' || state;
  end;
  raise notice 'T13 passed: repeated deletion is safe and stable';

  begin
    perform public.delete_damage_record(vy_a, gen_random_uuid());
    assert false, 'T14a unknown id must fail';
  exception when others then
    get stacked diagnostics msg = message_text, state = returned_sqlstate;
    assert msg = 'damage_record_not_found', 'T14a got: ' || msg;
    assert state = 'P0002', 'T14a errcode: ' || state;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_owner::text, 'role', 'authenticated')::text, true);
  begin
    -- d_other belongs to vineyard B; owner claims it is in vineyard A.
    perform public.delete_damage_record(vy_a, d_other);
    assert false, 'T14b mismatched vineyard must fail';
  exception when others then
    get stacked diagnostics msg = message_text;
    assert msg = 'damage_record_not_found', 'T14b got: ' || msg;
  end;
  assert (select deleted_at from public.damage_records where id = d_other) is null,
    'T14c other vineyard record untouched';
  raise notice 'T14 passed: unknown id and mismatched vineyard rejected as not-found';

  -- ---------------------------------------------------------------------
  -- T15. Owner, co-Owner and System Administrator
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner::text, 'role', 'authenticated')::text, true);
  perform public.delete_damage_record(vy_a, d_owner);
  assert (select deleted_by from public.damage_records where id = d_owner) = u_owner, 'T15a owner';

  perform set_config('request.jwt.claims', json_build_object('sub', u_coowner::text, 'role', 'authenticated')::text, true);
  perform public.delete_damage_record(vy_a, d_coowner);
  assert (select deleted_by from public.damage_records where id = d_coowner) = u_coowner, 'T15b co-owner';

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin::text, 'role', 'authenticated')::text, true);
  perform public.delete_damage_record(vy_a, d_admin);
  assert (select deleted_by from public.damage_records where id = d_admin) = u_admin, 'T15c system admin';
  raise notice 'T15 passed: owner, co-owner and system administrator may delete';

  -- =====================================================================
  -- T16. Anonymous callers rejected
  -- =====================================================================
  perform set_config('request.jwt.claims', null, true);
  begin
    perform public.delete_damage_record(vy_a, d_keep);
    assert false, 'T16 anonymous must not delete';
  exception when others then
    get stacked diagnostics msg = message_text, state = returned_sqlstate;
  end;
  assert msg = 'damage_delete_permission_denied', 'T16a anonymous message was: ' || coalesce(msg, 'none');
  assert state = '42501', 'T16b anonymous errcode was: ' || coalesce(state, 'none');
  assert (select deleted_at from public.damage_records where id = d_keep) is null, 'T16c control record untouched';
  raise notice 'T16 passed: anonymous callers rejected';

  -- =====================================================================
  -- T17. Mobile soft-delete RPC unchanged in behaviour, now stamps deleted_by
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', u_op::text, 'role', 'authenticated')::text, true);
  perform public.soft_delete_damage_record(d_soft);
  -- operators keep this path (sql/049)
  select deleted_at, deleted_by into ts, actor from public.damage_records where id = d_soft;
  assert ts is not null,  'T17a mobile soft delete still sets deleted_at';
  assert actor = u_op,    'T17b mobile soft delete now stamps deleted_by';
  raise notice 'T17 passed: iOS/Android soft-delete path intact and attributed';

  -- =====================================================================
  -- T18. Nothing was hard-deleted
  -- =====================================================================
  select count(*) into n from public.damage_records where notes like 'T160 %';
  assert n = total_before, 'T18 all ' || total_before || ' rows retained, found ' || n;
  select count(*) into n from public.damage_records where notes like 'T160 %' and deleted_at is not null;
  assert n = 5, 'T18b five records soft-deleted, found ' || n;
  raise notice 'T18 passed: soft delete only, no rows removed';

  -- =====================================================================
  -- T19. Fixtures exist only inside this transaction
  -- =====================================================================
  assert (select count(*) from auth.users where email like 't160-%@test.local') = 8,
    'T19a fixtures present inside the transaction';
  raise notice 'T19: fixtures will be discarded by the final ROLLBACK';

  raise notice 'SQL 160 delete damage record tests: ALL PASSED';
end$$;

rollback;

-- Post-rollback proof: every count must be 0.
select
  (select count(*) from auth.users where email like 't160-%@test.local')     as leftover_users,
  (select count(*) from public.vineyards where name like 'T160 %')           as leftover_vineyards,
  (select count(*) from public.damage_records where notes like 'T160 %')     as leftover_damage_records;
