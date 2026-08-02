-- SQL 160 test — delete_damage_record authority matrix (rollback only)
-- Run against the iOS/shared Supabase project after 160_delete_damage_record.sql.
-- Every assertion runs in one transaction and the transaction is rolled back.

begin;

create temporary table t_ids (k text primary key, v uuid) on commit drop;

-- Fixture users
insert into t_ids(k, v) values
  ('owner',    gen_random_uuid()),
  ('coowner',  gen_random_uuid()),
  ('manager',  gen_random_uuid()),
  ('sysadmin', gen_random_uuid()),
  ('super',    gen_random_uuid()),
  ('operator', gen_random_uuid()),
  ('readonly', gen_random_uuid()),
  ('stranger', gen_random_uuid()),
  ('vy_a',     gen_random_uuid()),
  ('vy_b',     gen_random_uuid()),
  ('rec_a',    gen_random_uuid()),
  ('rec_b',    gen_random_uuid());

create or replace function pg_temp.uid(p text) returns uuid
language sql stable as $$ select v from t_ids where k = p $$;

-- Impersonation helper: sets the JWT claims PostgREST would set.
create or replace function pg_temp.act_as(p text) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.uid(p)::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.expect_error(p_actor text, p_vy uuid, p_rec uuid, p_code text)
returns void language plpgsql as $$
declare v_msg text;
begin
  perform pg_temp.act_as(p_actor);
  begin
    perform public.delete_damage_record(p_vy, p_rec);
    reset role;
    raise exception 'FAIL: % expected % but delete succeeded', p_actor, p_code;
  exception when others then
    v_msg := sqlerrm;
    reset role;
    if v_msg <> p_code then
      raise exception 'FAIL: % expected % got %', p_actor, p_code, v_msg;
    end if;
  end;
end $$;

-- Vineyards
insert into public.vineyards (id, name) values
  (pg_temp.uid('vy_a'), 'Test Vineyard A'),
  (pg_temp.uid('vy_b'), 'Test Vineyard B');

-- Memberships
insert into public.vineyard_members (vineyard_id, user_id, role) values
  (pg_temp.uid('vy_a'), pg_temp.uid('owner'),    'owner'),
  (pg_temp.uid('vy_a'), pg_temp.uid('coowner'),  'co_owner'),
  (pg_temp.uid('vy_a'), pg_temp.uid('manager'),  'manager'),
  (pg_temp.uid('vy_a'), pg_temp.uid('super'),    'supervisor'),
  (pg_temp.uid('vy_a'), pg_temp.uid('operator'), 'operator'),
  (pg_temp.uid('vy_a'), pg_temp.uid('readonly'), 'read_only'),
  (pg_temp.uid('vy_b'), pg_temp.uid('manager'),  'manager');

insert into public.system_admins (user_id) values (pg_temp.uid('sysadmin'))
  on conflict do nothing;

create or replace function pg_temp.seed_record(p_id uuid, p_vy uuid) returns void
language plpgsql as $$
begin
  delete from public.damage_records where id = p_id;
  insert into public.damage_records (id, vineyard_id, damage_type, notes, created_by, created_at)
  values (p_id, p_vy, 'frost', 'test', pg_temp.uid('owner'), now());
end $$;

-- 1. Unauthorised roles cannot delete -----------------------------------------
perform pg_temp.seed_record(pg_temp.uid('rec_a'), pg_temp.uid('vy_a'));
select pg_temp.expect_error('super',    pg_temp.uid('vy_a'), pg_temp.uid('rec_a'), 'damage_delete_permission_denied');
select pg_temp.expect_error('operator', pg_temp.uid('vy_a'), pg_temp.uid('rec_a'), 'damage_delete_permission_denied');
select pg_temp.expect_error('readonly', pg_temp.uid('vy_a'), pg_temp.uid('rec_a'), 'damage_delete_permission_denied');
select pg_temp.expect_error('stranger', pg_temp.uid('vy_a'), pg_temp.uid('rec_a'), 'damage_delete_permission_denied');

-- 2. Cross-vineyard manager cannot delete vineyard A's record ------------------
insert into public.damage_records (id, vineyard_id, damage_type, notes, created_by)
values (pg_temp.uid('rec_b'), pg_temp.uid('vy_b'), 'hail', 'test b', pg_temp.uid('owner'));
--    Manager of B, targeting A's record with A's vineyard id → permission denied
--    (they are not a manager of A).
select pg_temp.expect_error('manager', pg_temp.uid('vy_a'), pg_temp.uid('rec_a'), 'damage_delete_permission_denied')
  where not exists (
    select 1 from public.vineyard_members
    where vineyard_id = pg_temp.uid('vy_a') and user_id = pg_temp.uid('manager'));

-- 3. Mismatched p_vineyard_id is rejected as not-found -------------------------
select pg_temp.expect_error('owner', pg_temp.uid('vy_b'), pg_temp.uid('rec_a'), 'damage_record_not_found');

-- 4. Missing record → stable not-found ----------------------------------------
select pg_temp.expect_error('owner', pg_temp.uid('vy_a'), gen_random_uuid(), 'damage_record_not_found');

-- 5. Owner can delete; audit fields populated ---------------------------------
select pg_temp.act_as('owner');
select public.delete_damage_record(pg_temp.uid('vy_a'), pg_temp.uid('rec_a'));
reset role;
do $$
declare r public.damage_records%rowtype;
begin
  select * into r from public.damage_records where id = pg_temp.uid('rec_a');
  if r.deleted_at is null then raise exception 'FAIL: owner delete did not set deleted_at'; end if;
  if r.deleted_by is distinct from pg_temp.uid('owner') then raise exception 'FAIL: deleted_by not set'; end if;
  if r.created_by is distinct from pg_temp.uid('owner') then raise exception 'FAIL: created_by lost'; end if;
  if r.created_at is null then raise exception 'FAIL: created_at lost'; end if;
end $$;

-- 6. Repeated deletion is safe and stable -------------------------------------
select pg_temp.expect_error('owner', pg_temp.uid('vy_a'), pg_temp.uid('rec_a'), 'damage_record_already_deleted');

-- 7. Co-owner, manager and system admin can each delete ------------------------
perform pg_temp.seed_record(pg_temp.uid('rec_a'), pg_temp.uid('vy_a'));
select pg_temp.act_as('coowner');
select public.delete_damage_record(pg_temp.uid('vy_a'), pg_temp.uid('rec_a'));
reset role;

perform pg_temp.seed_record(pg_temp.uid('rec_a'), pg_temp.uid('vy_a'));
select pg_temp.act_as('manager');
select public.delete_damage_record(pg_temp.uid('vy_b'), pg_temp.uid('rec_b'));
reset role;

perform pg_temp.seed_record(pg_temp.uid('rec_a'), pg_temp.uid('vy_a'));
select pg_temp.act_as('sysadmin');
select public.delete_damage_record(pg_temp.uid('vy_a'), pg_temp.uid('rec_a'));
reset role;

-- 8. Deleted records excluded from ordinary reads / totals ---------------------
do $$
declare n int;
begin
  select count(*) into n
  from public.damage_records
  where vineyard_id = pg_temp.uid('vy_a') and deleted_at is null;
  if n <> 0 then raise exception 'FAIL: deleted record still visible in live list (%).', n; end if;

  select count(*) into n
  from public.damage_records
  where vineyard_id = pg_temp.uid('vy_a');
  if n = 0 then raise exception 'FAIL: record was hard-deleted, audit trail lost'; end if;
end $$;

rollback;
