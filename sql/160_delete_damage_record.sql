-- =====================================================================
-- 160 · Manager-authorised Damage record deletion (portal contract)
-- =====================================================================
-- Shared VineTrack Supabase project (tbafuqwruefgkbyxrxyb) — the single
-- backend behind iOS, Android and the Lovable portal.
--
-- Additive only. Nothing existing is dropped or narrowed:
--   * `public.damage_records` keeps its soft-delete model (`deleted_at`).
--   * `public.soft_delete_damage_record(p_id uuid)` (sql/014 + sql/049)
--     is left in place — iOS and Android still call it. It is extended
--     here only to stamp the new `deleted_by` column so the audit trail
--     is identical no matter which client performed the delete.
--
-- Audited against the live schema conventions before writing:
--   * membership roles  = owner | manager | supervisor | operator
--                         (check constraint, sql/001) — there is no
--                         distinct "co-owner" role; a co-Owner is simply
--                         a second member with role = 'owner'.
--   * system admin      = public.is_system_admin()  (sql/062, active-only)
--   * role helper       = public.has_vineyard_role(uuid, text[]) (sql/001)
--   * soft delete       = deleted_at timestamptz null + updated_by uuid
--   * hard DELETE       = denied by RLS policy
--                         "damage_records_no_client_hard_delete" (sql/014)
--   * error convention  = raise exception '<stable_code>' using errcode
--                         (sql/155, sql/157)
--
-- Permission policy for the new RPC (deliberately NARROWER than the
-- existing soft-delete RPC, which sql/049 opened to operators):
--     ALLOW  Owner, co-Owner, Manager, System Administrator
--     DENY   Supervisor, Operator, read-only users, non-members,
--            Managers of a different vineyard, anonymous callers
--
-- Stable errors returned to the portal:
--     damage_delete_permission_denied   errcode 42501
--     damage_record_not_found           errcode P0002
--     damage_record_already_deleted     errcode 22023
--
-- Idempotent: safe to re-run over an already-applied SQL 160.
-- =====================================================================

-- ----- 1. deleted_by column -------------------------------------------------
-- Nullable (every pre-existing soft-deleted row has no attributed actor).
-- FK to auth.users with ON DELETE SET NULL so removing a user never
-- destroys the damage record itself.
alter table public.damage_records
  add column if not exists deleted_by uuid null
    references auth.users(id) on delete set null;

comment on column public.damage_records.deleted_by is
  'User who soft-deleted this damage record (portal RPC or mobile soft_delete_damage_record). Null for legacy deletions.';

create index if not exists damage_records_deleted_idx
  on public.damage_records (vineyard_id, deleted_at);

-- ----- 2. Authority helper --------------------------------------------------
-- Owner (incl. co-Owner, i.e. a second member with role = 'owner'),
-- Manager, or active System Administrator.
create or replace function public.can_manage_vineyard_damage(p_vineyard_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    return false;
  end if;

  if public.is_system_admin() then
    return true;
  end if;

  return public.has_vineyard_role(p_vineyard_id, array['owner', 'manager']);
end;
$function$;

revoke all on function public.can_manage_vineyard_damage(uuid) from public;
revoke all on function public.can_manage_vineyard_damage(uuid) from anon;
grant execute on function public.can_manage_vineyard_damage(uuid) to authenticated;

comment on function public.can_manage_vineyard_damage(uuid) is
  'True when the caller is an Owner/co-Owner or Manager of the vineyard, or an active System Administrator. Authority source for delete_damage_record.';

-- ----- 3. delete_damage_record ---------------------------------------------
-- Permission is checked BEFORE existence so an unauthorised caller cannot
-- use the not-found error to probe another vineyard's record ids.
create or replace function public.delete_damage_record(
  p_vineyard_id uuid,
  p_damage_record_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_deleted_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'damage_delete_permission_denied' using errcode = '42501';
  end if;

  if not public.can_manage_vineyard_damage(p_vineyard_id) then
    raise exception 'damage_delete_permission_denied' using errcode = '42501';
  end if;

  -- Must exist AND belong to the claimed vineyard.
  if not exists (
    select 1
    from public.damage_records
    where id = p_damage_record_id
      and vineyard_id = p_vineyard_id
  ) then
    raise exception 'damage_record_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.damage_records
    where id = p_damage_record_id
      and vineyard_id = p_vineyard_id
      and deleted_at is not null
  ) then
    raise exception 'damage_record_already_deleted' using errcode = '22023';
  end if;

  update public.damage_records
     set deleted_at = now(),
         deleted_by = auth.uid(),
         updated_by = auth.uid()
   where id = p_damage_record_id
     and vineyard_id = p_vineyard_id
     and deleted_at is null
  returning deleted_at into v_deleted_at;

  -- Lost the race to a concurrent delete.
  if v_deleted_at is null then
    raise exception 'damage_record_already_deleted' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'damage_record_id', p_damage_record_id,
    'vineyard_id',      p_vineyard_id,
    'deleted_at',       v_deleted_at,
    'deleted_by',       auth.uid()
  );
end;
$function$;

revoke all on function public.delete_damage_record(uuid, uuid) from public;
revoke all on function public.delete_damage_record(uuid, uuid) from anon;
grant execute on function public.delete_damage_record(uuid, uuid) to authenticated;

comment on function public.delete_damage_record(uuid, uuid) is
  'Manager-authorised soft delete of a damage record. Sets deleted_at/deleted_by; the row is retained. Errors: damage_delete_permission_denied, damage_record_not_found, damage_record_already_deleted.';

-- ----- 4. Keep the mobile soft-delete RPC audit-consistent ------------------
-- OPTIONAL / SEPARABLE: iOS and Android still call
-- soft_delete_damage_record(p_id). Without this block their deletes would
-- leave deleted_by null while portal deletes populate it. Behaviour,
-- signature, grants and the sql/049 role set are all unchanged — the only
-- difference is that deleted_by is now stamped.
create or replace function public.soft_delete_damage_record(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_vineyard_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select vineyard_id into v_vineyard_id from public.damage_records where id = p_id;
  if v_vineyard_id is null then raise exception 'Damage record not found'; end if;

  if not public.has_vineyard_role(v_vineyard_id, array['owner','manager','supervisor','operator']) then
    raise exception 'Insufficient permissions to delete damage record';
  end if;

  update public.damage_records
     set deleted_at = now(),
         deleted_by = coalesce(deleted_by, auth.uid()),
         updated_by = auth.uid()
   where id = p_id;
end;
$function$;

revoke all on function public.soft_delete_damage_record(uuid) from public;
revoke all on function public.soft_delete_damage_record(uuid) from anon;
grant execute on function public.soft_delete_damage_record(uuid) to authenticated;
