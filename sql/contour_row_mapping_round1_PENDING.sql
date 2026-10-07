-- Contour Row Mapping (Beta) — Round 1 draft persistence.
-- STATUS: PENDING — NOT APPLIED. Prepared by the Portal for Rork review.
-- Rork: assign the next free migration number on the shared VineTrack
-- database before applying (repo numbering is not authoritative; 270/271
-- are already live).
--
-- Assumptions to confirm (same helpers sql/265 relies on):
--   * public.is_system_admin() returns the caller's active System Admin status.
--   * public.vineyard_members(vineyard_id, user_id) is the membership table.
--   * public.paddocks(id, vineyard_id) exists.
--
-- Contract: docs/contour-row-mapping-contract.md
-- Additive only. Does NOT touch paddocks or any operational geometry, so
-- older iOS/Android builds keep saving blocks without affecting drafts.

begin;

create table if not exists public.contour_row_mapping_drafts (
  id uuid primary key default gen_random_uuid(),
  vineyard_id uuid not null,
  paddock_id uuid not null unique references public.paddocks(id) on delete cascade,
  draft_id uuid not null,
  schema_version integer not null,
  revision integer not null check (revision >= 1),
  payload jsonb not null,
  last_client_save_id uuid,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contour_row_mapping_drafts enable row level security;
revoke all on public.contour_row_mapping_drafts from public, anon, authenticated;
-- No direct table grants: all access is through the RPCs below.

create or replace function public.vt_contour_mapping_can_access(p_vineyard_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_system_admin(), false)
     and exists (select 1 from public.vineyard_members m
                 where m.vineyard_id = p_vineyard_id and m.user_id = auth.uid());
$$;
revoke all on function public.vt_contour_mapping_can_access(uuid) from public, anon;
grant execute on function public.vt_contour_mapping_can_access(uuid) to authenticated;

-- Defence in depth if a grant is ever added later.
create policy contour_drafts_admin_select on public.contour_row_mapping_drafts
  for select to authenticated using (public.vt_contour_mapping_can_access(vineyard_id));

create or replace function public.vt_contour_validate_payload(p jsonb, p_vineyard uuid, p_paddock uuid)
returns void language plpgsql immutable set search_path = public as $$
declare
  v_rows int; v_pts int; v_groups int;
begin
  if pg_column_size(p) > 4000000 then raise exception 'invalid_payload_too_large'; end if;
  if p->>'schema' <> 'vinetrack.contour_row_mapping_draft' or (p->>'version')::int <> 1 then
    raise exception 'invalid_schema_version'; end if;
  if (p->>'vineyardId')::uuid <> p_vineyard or (p->>'paddockId')::uuid <> p_paddock then
    raise exception 'invalid_scope'; end if;
  select count(*) into v_groups from jsonb_array_elements(p->'groups');
  if v_groups > 50 then raise exception 'invalid_too_many_groups'; end if;
  select count(*) into v_rows from jsonb_array_elements(p->'groups') g, jsonb_array_elements(g->'rows') r;
  if v_rows > 2000 then raise exception 'invalid_too_many_rows'; end if;
  select count(*) into v_pts
    from jsonb_array_elements(p->'groups') g, jsonb_array_elements(g->'rows') r,
         jsonb_array_elements(r->'parts') pt, jsonb_array_elements(pt->'points') q;
  if v_pts > 200000 then raise exception 'invalid_too_many_points'; end if;
  -- Unique physical row numbers across the whole draft.
  if exists (select (r->>'number') from jsonb_array_elements(p->'groups') g, jsonb_array_elements(g->'rows') r
             group by 1 having count(*) > 1) then raise exception 'invalid_duplicate_row_number'; end if;
  -- Unique ids (draft, groups, masks, rows, parts).
  if exists (
    select id from (
      select p->>'draftId' as id
      union all select g->>'id' from jsonb_array_elements(p->'groups') g
      union all select m->>'id' from jsonb_array_elements(p->'groups') g, jsonb_array_elements(g->'exclusions') m
      union all select r->>'id' from jsonb_array_elements(p->'groups') g, jsonb_array_elements(g->'rows') r
      union all select pt->>'id' from jsonb_array_elements(p->'groups') g, jsonb_array_elements(g->'rows') r, jsonb_array_elements(r->'parts') pt
    ) s group by id having count(*) > 1 or id is null
  ) then raise exception 'invalid_duplicate_id'; end if;
  -- Every part ≥ 2 points; every point within WGS84 range.
  if exists (select 1 from jsonb_array_elements(p->'groups') g, jsonb_array_elements(g->'rows') r,
             jsonb_array_elements(r->'parts') pt where jsonb_array_length(pt->'points') < 2)
     then raise exception 'invalid_degenerate_part'; end if;
  if exists (select 1 from jsonb_array_elements(p->'groups') g, jsonb_array_elements(g->'rows') r,
             jsonb_array_elements(r->'parts') pt, jsonb_array_elements(pt->'points') q
             where jsonb_typeof(q->'lat') <> 'number' or jsonb_typeof(q->'lng') <> 'number'
                or abs((q->>'lat')::numeric) > 90 or abs((q->>'lng')::numeric) > 180)
     then raise exception 'invalid_coordinates'; end if;
end $$;
revoke all on function public.vt_contour_validate_payload(jsonb, uuid, uuid) from public, anon, authenticated;

create or replace function public.get_contour_row_mapping_draft(p_paddock_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_vineyard uuid; d public.contour_row_mapping_drafts;
begin
  select vineyard_id into v_vineyard from public.paddocks where id = p_paddock_id;
  if v_vineyard is null or not public.vt_contour_mapping_can_access(v_vineyard) then
    raise exception 'not_authorised' using errcode = '42501'; end if;
  select * into d from public.contour_row_mapping_drafts where paddock_id = p_paddock_id and vineyard_id = v_vineyard;
  if not found then return null; end if;
  return jsonb_build_object('revision', d.revision, 'payload', d.payload, 'updated_at', d.updated_at, 'updated_by', d.updated_by);
end $$;

create or replace function public.save_contour_row_mapping_draft(
  p_paddock_id uuid, p_expected_revision integer, p_client_save_id uuid, p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_vineyard uuid; d public.contour_row_mapping_drafts;
begin
  select vineyard_id into v_vineyard from public.paddocks where id = p_paddock_id;
  if v_vineyard is null or not public.vt_contour_mapping_can_access(v_vineyard) then
    raise exception 'not_authorised' using errcode = '42501'; end if;
  perform public.vt_contour_validate_payload(p_payload, v_vineyard, p_paddock_id);

  select * into d from public.contour_row_mapping_drafts where paddock_id = p_paddock_id for update;
  if found then
    if d.vineyard_id <> v_vineyard then raise exception 'invalid_scope'; end if;
    -- Idempotent retry of the save that already landed.
    if d.last_client_save_id = p_client_save_id and d.revision = p_expected_revision + 1 then
      return jsonb_build_object('revision', d.revision, 'payload', d.payload, 'updated_at', d.updated_at);
    end if;
    if d.revision <> p_expected_revision then raise exception 'stale_revision'; end if;
    if d.draft_id <> (p_payload->>'draftId')::uuid then raise exception 'stale_revision'; end if;
    update public.contour_row_mapping_drafts
       set payload = p_payload, revision = d.revision + 1, schema_version = (p_payload->>'version')::int,
           last_client_save_id = p_client_save_id, updated_by = auth.uid(), updated_at = now()
     where id = d.id returning * into d;
  else
    if p_expected_revision <> 0 then raise exception 'stale_revision'; end if;
    insert into public.contour_row_mapping_drafts
      (vineyard_id, paddock_id, draft_id, schema_version, revision, payload, last_client_save_id, created_by, updated_by)
    values (v_vineyard, p_paddock_id, (p_payload->>'draftId')::uuid, (p_payload->>'version')::int, 1,
            p_payload, p_client_save_id, auth.uid(), auth.uid())
    returning * into d;
  end if;
  return jsonb_build_object('revision', d.revision, 'payload', d.payload, 'updated_at', d.updated_at);
end $$;

create or replace function public.discard_contour_row_mapping_draft(p_paddock_id uuid, p_expected_revision integer)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_vineyard uuid; v_rev int;
begin
  select vineyard_id into v_vineyard from public.paddocks where id = p_paddock_id;
  if v_vineyard is null or not public.vt_contour_mapping_can_access(v_vineyard) then
    raise exception 'not_authorised' using errcode = '42501'; end if;
  select revision into v_rev from public.contour_row_mapping_drafts where paddock_id = p_paddock_id for update;
  if not found then return; end if;
  if v_rev <> p_expected_revision then raise exception 'stale_revision'; end if;
  delete from public.contour_row_mapping_drafts where paddock_id = p_paddock_id;
end $$;

revoke all on function public.get_contour_row_mapping_draft(uuid) from public, anon;
revoke all on function public.save_contour_row_mapping_draft(uuid, integer, uuid, jsonb) from public, anon;
revoke all on function public.discard_contour_row_mapping_draft(uuid, integer) from public, anon;
grant execute on function public.get_contour_row_mapping_draft(uuid) to authenticated;
grant execute on function public.save_contour_row_mapping_draft(uuid, integer, uuid, jsonb) to authenticated;
grant execute on function public.discard_contour_row_mapping_draft(uuid, integer) to authenticated;

commit;
