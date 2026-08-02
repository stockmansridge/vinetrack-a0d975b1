-- SQL 160 — Manager-authorised soft delete for damage records
--
-- Target project: iOS/shared Supabase project (tbafuqwruefgkbyxrxyb).
-- The Lovable portal cannot apply migrations to that project — this file is the
-- migration for the Rork/iOS team to run there.
--
-- Model: SOFT delete (matches every other VineTrack operational record).
--   public.damage_records.deleted_at  timestamptz   (already exists)
--   public.damage_records.deleted_by  uuid          (added below)
--
-- Authority: vineyard owner-level membership, manager, or system admin.
-- All checks are server-side; nothing is trusted from the browser.

begin;

alter table public.damage_records
  add column if not exists deleted_by uuid null;

create index if not exists damage_records_deleted_idx
  on public.damage_records (vineyard_id, deleted_at);

-- ---------------------------------------------------------------------------
-- Canonical authority helper (owner / co-owner / manager / system admin)
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_vineyard_damage(p_vineyard_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(public.is_system_admin(), false)
    or exists (
      select 1
      from public.vineyard_members vm
      where vm.vineyard_id = p_vineyard_id
        and vm.user_id = auth.uid()
        and vm.role in ('owner', 'co_owner', 'co-owner', 'coowner', 'manager')
        and coalesce(vm.deleted_at, null) is null
    );
$$;

revoke all on function public.can_manage_vineyard_damage(uuid) from public, anon;
grant execute on function public.can_manage_vineyard_damage(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_damage_record — soft delete with stable error codes
--   damage_delete_permission_denied
--   damage_record_not_found
--   damage_record_already_deleted
-- ---------------------------------------------------------------------------
create or replace function public.delete_damage_record(
  p_vineyard_id uuid,
  p_damage_record_id uuid
)
returns table (
  id uuid,
  vineyard_id uuid,
  paddock_id uuid,
  deleted_at timestamptz,
  deleted_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.damage_records%rowtype;
begin
  if auth.uid() is null then
    raise exception 'damage_delete_permission_denied'
      using errcode = '42501';
  end if;

  select * into v_rec
  from public.damage_records dr
  where dr.id = p_damage_record_id
  for update;

  -- Not found, or belongs to a different vineyard than the caller claimed.
  if not found or v_rec.vineyard_id is distinct from p_vineyard_id then
    raise exception 'damage_record_not_found'
      using errcode = 'P0002';
  end if;

  if not public.can_manage_vineyard_damage(v_rec.vineyard_id) then
    raise exception 'damage_delete_permission_denied'
      using errcode = '42501';
  end if;

  if v_rec.deleted_at is not null then
    raise exception 'damage_record_already_deleted'
      using errcode = 'P0001';
  end if;

  update public.damage_records dr
     set deleted_at        = now(),
         deleted_by        = auth.uid(),
         updated_by        = auth.uid(),
         updated_at        = now(),
         client_updated_at = now(),
         sync_version      = coalesce(dr.sync_version, 0) + 1
   where dr.id = v_rec.id;

  return query
    select dr.id, dr.vineyard_id, dr.paddock_id, dr.deleted_at, dr.deleted_by
    from public.damage_records dr
    where dr.id = v_rec.id;
end;
$$;

revoke all on function public.delete_damage_record(uuid, uuid) from public, anon;
grant execute on function public.delete_damage_record(uuid, uuid) to authenticated;

comment on function public.delete_damage_record(uuid, uuid) is
  'Soft-deletes a damage record. Owner/co-owner/manager of the vineyard or a system admin only. Stable errors: damage_delete_permission_denied, damage_record_not_found, damage_record_already_deleted.';

commit;
