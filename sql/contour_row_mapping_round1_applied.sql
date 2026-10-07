-- Contour Row Mapping (Beta) — Round 1 draft persistence (revision 2).
-- STATUS: APPLIED to the shared VineTrack database on 2026-10-07 as
-- migration "contour_row_mapping_round1" (applied through the authorised
-- Supabase integration from commit
-- 69b4a256597dce38b74391666555922e084d06a8). Do NOT run again.
-- Not a numbered Rork migration; no number was assigned.
-- Verified with sql/contour_row_mapping_round1_VERIFY_rollback.sql using real
-- fixtures (admin+member block; genuine non-admin on own member block; admin
-- on a block outside their memberships), plus mutation denials: all checks
-- passed, paddock hash unchanged, all 3 tables empty after rollback. Security
-- advisor: three expected private-table RLS/no-policy notices (drafts, saves,
-- discarded_drafts — intentional: no grants/policies, access only via the
-- authorised private definer functions; do not add grants or permissive
-- policies to silence them); RPC privileges verified (all 3 public RPCs
-- SECURITY INVOKER, anon EXECUTE=false, authenticated EXECUTE=true).
-- The race check is stale-first-save
-- contract coverage, not a simultaneous two-connection test.
-- The executable body below is unchanged from the applied file.
-- Live helpers used (confirmed):
--   public.is_system_admin()        -> system_admins, auth.uid(), is_active = true
--   public.is_vineyard_member(uuid) -> vineyards.owner_id = auth.uid() OR a vineyard_members row
--   public.paddocks / public.vineyards both have deleted_at (archived/deleted are denied).
-- public.get_my_vineyard_access(uuid) is NOT used: it is an entitlement /
-- enter-vineyard decision for operational use; this review-only pilot is
-- gated on System Admin + vineyard membership/ownership.
--
-- Contract: docs/contour-row-mapping-contract.md
-- Additive only: new private schema, new tables, new functions. Does NOT
-- touch paddocks, vineyards or any existing table/RPC/data. Older iOS /
-- Android builds cannot see drafts.

begin;

create schema if not exists vt_contour_private;
revoke all on schema vt_contour_private from public, anon, authenticated;
grant usage on schema vt_contour_private to authenticated;

-- One slot per block. The slot outlives discards: draft_id/payload become
-- NULL and revision keeps increasing, so revisions never reset.
create table if not exists vt_contour_private.drafts (
  paddock_id uuid primary key references public.paddocks(id) on delete cascade,
  vineyard_id uuid not null,
  draft_id uuid,
  schema_version integer,
  revision integer not null check (revision >= 1),
  payload jsonb,
  payload_md5 text,
  last_client_save_id uuid,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((draft_id is null) = (payload is null))
);

-- Tombstones: a discarded draft id can never be saved or discarded again.
create table if not exists vt_contour_private.discarded_drafts (
  draft_id uuid primary key,
  paddock_id uuid not null references public.paddocks(id) on delete cascade,
  discarded_revision integer not null,
  discarded_by uuid not null,
  discarded_at timestamptz not null default now()
);

-- Idempotency ledger: every accepted client save id with its content hash.
create table if not exists vt_contour_private.saves (
  client_save_id uuid primary key,
  paddock_id uuid not null references public.paddocks(id) on delete cascade,
  draft_id uuid not null,
  revision integer not null,
  payload_md5 text not null,
  saved_by uuid not null,
  saved_at timestamptz not null default now()
);

alter table vt_contour_private.drafts enable row level security;
alter table vt_contour_private.discarded_drafts enable row level security;
alter table vt_contour_private.saves enable row level security;
revoke all on all tables in schema vt_contour_private from public, anon, authenticated;
-- No policies and no grants: only the SECURITY DEFINER functions below touch these tables.

-- ------------------------------------------------------------- helpers

create or replace function vt_contour_private.is_uuid(t text)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select t is not null and t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

-- jsonb integer in [lo, hi]; NULL/non-number/fraction -> false (never NULL).
create or replace function vt_contour_private.is_int(v jsonb, lo numeric, hi numeric)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select coalesce(jsonb_typeof(v) = 'number' and (v#>>'{}')::numeric = trunc((v#>>'{}')::numeric)
                  and (v#>>'{}')::numeric between lo and hi, false)
$$;

create or replace function vt_contour_private.is_num(v jsonb, lo numeric, hi numeric)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select coalesce(jsonb_typeof(v) = 'number' and (v#>>'{}')::numeric between lo and hi, false)
$$;

-- Array of WGS84 {lat,lng} points, length within [lo, hi].
create or replace function vt_contour_private.is_points(v jsonb, lo int, hi int)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare q jsonb;
begin
  if v is null or jsonb_typeof(v) <> 'array' or jsonb_array_length(v) < lo or jsonb_array_length(v) > hi then return false; end if;
  for q in select * from jsonb_array_elements(v) loop
    if jsonb_typeof(q) <> 'object'
       or not vt_contour_private.is_num(q->'lat', -90, 90)
       or not vt_contour_private.is_num(q->'lng', -180, 180) then return false; end if;
  end loop;
  return true;
end $$;

-- Authorisation: active System Admin AND owner/member of the block's live
-- vineyard; block and vineyard not archived. Returns the vineyard id or raises.
create or replace function vt_contour_private.authorise(p_paddock_id uuid)
returns uuid language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'not_authorised' using errcode = '42501'; end if;
  if p_paddock_id is null then raise exception 'invalid_paddock' using errcode = '22023'; end if;
  select p.vineyard_id into v
    from public.paddocks p join public.vineyards y on y.id = p.vineyard_id
   where p.id = p_paddock_id and p.deleted_at is null and y.deleted_at is null;
  if v is null
     or not coalesce(public.is_system_admin(), false)
     or not coalesce(public.is_vineyard_member(v), false) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  return v;
end $$;

-- Strict, null-safe structural validation. Mirrors validateDraftShape() in
-- src/lib/contourRows/draft.ts. Byte limits are 1.5x the Portal's compact
-- JSON limits because jsonb text adds spacing.
-- Explicit in-progress rule: zero groups, and groups with no rows and a
-- partial reference trace (0..500 points), are valid. Working areas and
-- cut-outs, when present, must have >= 3 points.
create or replace function vt_contour_private.validate_payload(p jsonb, p_vineyard uuid, p_paddock uuid)
returns void language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  g jsonb; r jsonb; pt jsonb; m jsonb;
  v_rows int := 0; v_pts int := 0; v_ids text[] := '{}'; v_nums int[] := '{}';
  v_canon text[];
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'invalid_payload' using errcode = '22023'; end if;
  if octet_length(p::text) > 6000000 then raise exception 'invalid_payload_too_large' using errcode = '22023'; end if;
  if coalesce(p->>'schema', '') <> 'vinetrack.contour_row_mapping_draft' or not vt_contour_private.is_int(p->'version', 1, 1) then
    raise exception 'invalid_schema_version' using errcode = '22023'; end if;
  if not vt_contour_private.is_uuid(p->>'draftId') or not vt_contour_private.is_uuid(p->>'vineyardId') or not vt_contour_private.is_uuid(p->>'paddockId') then
    raise exception 'invalid_identity' using errcode = '22023'; end if;
  if (p->>'vineyardId')::uuid is distinct from p_vineyard or (p->>'paddockId')::uuid is distinct from p_paddock then
    raise exception 'invalid_scope' using errcode = '22023'; end if;
  if jsonb_typeof(p->'groups') is distinct from 'array' then raise exception 'invalid_groups' using errcode = '22023'; end if;
  if jsonb_array_length(p->'groups') > 50 then raise exception 'invalid_too_many_groups' using errcode = '22023'; end if;
  v_ids := array_append(v_ids, lower(p->>'draftId'));

  select coalesce(array_agg(e->>'id'), '{}') into v_canon
    from public.paddocks pk, jsonb_array_elements(case when jsonb_typeof(pk.rows::jsonb) = 'array' then pk.rows::jsonb else '[]'::jsonb end) e
   where pk.id = p_paddock;

  for g in select * from jsonb_array_elements(p->'groups') loop
    if jsonb_typeof(g) <> 'object' or not vt_contour_private.is_uuid(g->>'id') then raise exception 'invalid_group' using errcode = '22023'; end if;
    v_ids := array_append(v_ids, lower(g->>'id'));
    if jsonb_typeof(g->'name') is distinct from 'string' or char_length(g->>'name') > 120 then raise exception 'invalid_group_name' using errcode = '22023'; end if;
    if coalesce(g->>'mode', '') not in ('straight', 'contour', 'imported') then raise exception 'invalid_group_mode' using errcode = '22023'; end if;
    if not vt_contour_private.is_points(g->'referenceTrace', 0, 500) or octet_length((g->'referenceTrace')::text) > 90000 then
      raise exception 'invalid_reference_trace' using errcode = '22023'; end if;
    if not vt_contour_private.is_int(g->'smoothing', 0, 2)
       or not vt_contour_private.is_num(g->'spacingM', 0.5, 20)
       or not vt_contour_private.is_int(g->'startNumber', 1, 100000)
       or not vt_contour_private.is_int(g->'leftCount', 0, 300)
       or not vt_contour_private.is_int(g->'rightCount', 0, 300)
       or jsonb_typeof(g->'ascending') is distinct from 'boolean'
       or jsonb_typeof(g->'extendToArea') is distinct from 'boolean' then
      raise exception 'invalid_group_settings' using errcode = '22023'; end if;
    if not (g ? 'workingArea') then raise exception 'invalid_working_area' using errcode = '22023'; end if;
    if jsonb_typeof(g->'workingArea') <> 'null'
       and (not vt_contour_private.is_points(g->'workingArea', 3, 500) or octet_length((g->'workingArea')::text) > 90000) then
      raise exception 'invalid_working_area' using errcode = '22023'; end if;
    if jsonb_typeof(g->'exclusions') is distinct from 'array' or jsonb_array_length(g->'exclusions') > 50 then
      raise exception 'invalid_exclusions' using errcode = '22023'; end if;
    for m in select * from jsonb_array_elements(g->'exclusions') loop
      if jsonb_typeof(m) <> 'object' or not vt_contour_private.is_uuid(m->>'id')
         or not vt_contour_private.is_points(m->'points', 3, 500) or octet_length((m->'points')::text) > 90000 then
        raise exception 'invalid_exclusion' using errcode = '22023'; end if;
      v_ids := array_append(v_ids, lower(m->>'id'));
    end loop;
    if jsonb_typeof(g->'rows') is distinct from 'array' then raise exception 'invalid_rows' using errcode = '22023'; end if;
    for r in select * from jsonb_array_elements(g->'rows') loop
      v_rows := v_rows + 1;
      if jsonb_typeof(r) <> 'object' or not vt_contour_private.is_uuid(r->>'id') then raise exception 'invalid_row' using errcode = '22023'; end if;
      v_ids := array_append(v_ids, lower(r->>'id'));
      if not vt_contour_private.is_int(r->'number', 1, 100000) then raise exception 'invalid_row_number' using errcode = '22023'; end if;
      v_nums := array_append(v_nums, (r->>'number')::int);
      if not (r ? 'offsetIndex') or (jsonb_typeof(r->'offsetIndex') <> 'null' and not vt_contour_private.is_int(r->'offsetIndex', -300, 300)) then
        raise exception 'invalid_row_offset' using errcode = '22023'; end if;
      if coalesce(r->>'provenance', '') not in ('generated', 'edited', 'imported') then raise exception 'invalid_row_provenance' using errcode = '22023'; end if;
      if not (r ? 'canonicalRowId') or (jsonb_typeof(r->'canonicalRowId') <> 'null' and not vt_contour_private.is_uuid(r->>'canonicalRowId')) then
        raise exception 'invalid_canonical_row' using errcode = '22023'; end if;
      if jsonb_typeof(r->'canonicalRowId') = 'string' and not (r->>'canonicalRowId' = any(v_canon)) then
        raise exception 'invalid_canonical_row_not_in_block' using errcode = '22023'; end if;
      if r ? 'source' and jsonb_typeof(r->'source') not in ('null', 'object') or octet_length(coalesce(r->'source', 'null')::text) > 3000 then
        raise exception 'invalid_row_source' using errcode = '22023'; end if;
      if octet_length(r::text) > 300000 then raise exception 'invalid_row_too_large' using errcode = '22023'; end if;
      if jsonb_typeof(r->'parts') is distinct from 'array' or jsonb_array_length(r->'parts') < 1 or jsonb_array_length(r->'parts') > 50 then
        raise exception 'invalid_row_parts' using errcode = '22023'; end if;
      for pt in select * from jsonb_array_elements(r->'parts') loop
        if jsonb_typeof(pt) <> 'object' or not vt_contour_private.is_uuid(pt->>'id')
           or not vt_contour_private.is_points(pt->'points', 2, 2000) then
          raise exception 'invalid_row_part' using errcode = '22023'; end if;
        v_ids := array_append(v_ids, lower(pt->>'id'));
        v_pts := v_pts + jsonb_array_length(pt->'points');
        if (select count(distinct (q->>'lat', q->>'lng')) from jsonb_array_elements(pt->'points') q) < 2 then
          raise exception 'invalid_zero_length_part' using errcode = '22023'; end if;
      end loop;
    end loop;
  end loop;
  if v_rows > 2000 then raise exception 'invalid_too_many_rows' using errcode = '22023'; end if;
  if v_pts > 200000 then raise exception 'invalid_too_many_points' using errcode = '22023'; end if;
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then raise exception 'invalid_duplicate_id' using errcode = '22023'; end if;
  if cardinality(v_nums) <> (select count(distinct x) from unnest(v_nums) x) then raise exception 'invalid_duplicate_row_number' using errcode = '22023'; end if;
  -- Geometry (self-intersection, crossings, outside block) is checked by the
  -- Portal before save; the server enforces structure, ranges and identity.
end $$;

-- ------------------------------------------------- implementations

create or replace function vt_contour_private.get_draft(p_paddock_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_vineyard uuid; d vt_contour_private.drafts;
begin
  v_vineyard := vt_contour_private.authorise(p_paddock_id);
  select * into d from vt_contour_private.drafts where paddock_id = p_paddock_id and vineyard_id = v_vineyard;
  if not found then return null; end if;
  return jsonb_build_object('draft_id', d.draft_id, 'revision', d.revision, 'payload', d.payload,
    'last_client_save_id', d.last_client_save_id, 'updated_at', d.updated_at, 'updated_by', d.updated_by);
end $$;

create or replace function vt_contour_private.save_draft(
  p_paddock_id uuid, p_expected_draft_id uuid, p_expected_revision integer, p_client_save_id uuid, p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare
  v_vineyard uuid; d vt_contour_private.drafts; s vt_contour_private.saves;
  v_md5 text; v_draft uuid; v_uid uuid := auth.uid();
begin
  v_vineyard := vt_contour_private.authorise(p_paddock_id);
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'invalid_expected_revision' using errcode = '22023'; end if;
  if p_client_save_id is null then raise exception 'invalid_client_save_id' using errcode = '22023'; end if;
  -- Serialise every save/discard for this block (covers two racing first saves).
  perform pg_advisory_xact_lock(hashtextextended('vt_contour_draft:' || p_paddock_id::text, 0));
  perform vt_contour_private.validate_payload(p_payload, v_vineyard, p_paddock_id);
  v_md5 := md5(p_payload::text);  -- jsonb text is canonical (key order independent)
  v_draft := (p_payload->>'draftId')::uuid;

  -- Idempotent replay: same id must carry the same block, draft and content.
  select * into s from vt_contour_private.saves where client_save_id = p_client_save_id;
  if found then
    if s.paddock_id <> p_paddock_id or s.draft_id <> v_draft or s.payload_md5 <> v_md5 then
      raise exception 'invalid_client_save_id_reused' using errcode = '22023'; end if;
    return jsonb_build_object('draft_id', s.draft_id, 'revision', s.revision, 'client_save_id', s.client_save_id, 'replayed', true);
  end if;

  if exists (select 1 from vt_contour_private.discarded_drafts where draft_id = v_draft) then
    raise exception 'stale_draft_discarded' using errcode = '40001'; end if;
  if p_expected_draft_id is not null and p_expected_draft_id <> v_draft then
    raise exception 'stale_revision' using errcode = '40001'; end if;

  select * into d from vt_contour_private.drafts where paddock_id = p_paddock_id for update;
  if not found then
    if p_expected_draft_id is not null or p_expected_revision <> 0 then raise exception 'stale_revision' using errcode = '40001'; end if;
    insert into vt_contour_private.drafts
      (paddock_id, vineyard_id, draft_id, schema_version, revision, payload, payload_md5, last_client_save_id, created_by, updated_by)
    values (p_paddock_id, v_vineyard, v_draft, 1, 1, p_payload, v_md5, p_client_save_id, v_uid, v_uid)
    returning * into d;
  else
    if d.vineyard_id <> v_vineyard then raise exception 'invalid_scope' using errcode = '22023'; end if;
    if d.revision <> p_expected_revision or d.draft_id is distinct from p_expected_draft_id then
      raise exception 'stale_revision' using errcode = '40001'; end if;
    update vt_contour_private.drafts
       set draft_id = v_draft, schema_version = 1, payload = p_payload, payload_md5 = v_md5,
           revision = d.revision + 1, last_client_save_id = p_client_save_id, updated_by = v_uid, updated_at = now()
     where paddock_id = p_paddock_id returning * into d;
  end if;
  insert into vt_contour_private.saves (client_save_id, paddock_id, draft_id, revision, payload_md5, saved_by)
  values (p_client_save_id, p_paddock_id, v_draft, d.revision, v_md5, v_uid);
  return jsonb_build_object('draft_id', d.draft_id, 'revision', d.revision, 'client_save_id', p_client_save_id, 'replayed', false);
end $$;

create or replace function vt_contour_private.discard_draft(p_paddock_id uuid, p_draft_id uuid, p_expected_revision integer)
returns jsonb language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_vineyard uuid; d vt_contour_private.drafts; t vt_contour_private.discarded_drafts;
begin
  v_vineyard := vt_contour_private.authorise(p_paddock_id);
  if p_draft_id is null then raise exception 'invalid_draft_id' using errcode = '22023'; end if;
  if p_expected_revision is null or p_expected_revision < 1 then raise exception 'invalid_expected_revision' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vt_contour_draft:' || p_paddock_id::text, 0));
  -- Idempotent: repeating a discard of the same draft succeeds without touching a replacement.
  select * into t from vt_contour_private.discarded_drafts where draft_id = p_draft_id;
  if found then
    if t.paddock_id <> p_paddock_id then raise exception 'stale_revision' using errcode = '40001'; end if;
    return jsonb_build_object('revision', t.discarded_revision, 'already_discarded', true);
  end if;
  select * into d from vt_contour_private.drafts where paddock_id = p_paddock_id for update;
  if not found or d.draft_id is distinct from p_draft_id or d.revision <> p_expected_revision then
    raise exception 'stale_revision' using errcode = '40001'; end if;
  update vt_contour_private.drafts
     set draft_id = null, payload = null, payload_md5 = null, schema_version = null,
         revision = d.revision + 1, last_client_save_id = null, updated_by = auth.uid(), updated_at = now()
   where paddock_id = p_paddock_id returning * into d;
  insert into vt_contour_private.discarded_drafts (draft_id, paddock_id, discarded_revision, discarded_by)
  values (p_draft_id, p_paddock_id, d.revision, auth.uid());
  return jsonb_build_object('revision', d.revision, 'already_discarded', false);
end $$;

revoke all on all functions in schema vt_contour_private from public, anon, authenticated;
grant execute on function vt_contour_private.get_draft(uuid) to authenticated;
grant execute on function vt_contour_private.save_draft(uuid, uuid, integer, uuid, jsonb) to authenticated;
grant execute on function vt_contour_private.discard_draft(uuid, uuid, integer) to authenticated;

-- ------------------------------------------- public SECURITY INVOKER API

create or replace function public.get_contour_row_mapping_draft(p_paddock_id uuid)
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select vt_contour_private.get_draft(p_paddock_id)
$$;

create or replace function public.save_contour_row_mapping_draft(
  p_paddock_id uuid, p_expected_draft_id uuid, p_expected_revision integer, p_client_save_id uuid, p_payload jsonb)
returns jsonb language sql volatile security invoker set search_path = pg_catalog as $$
  select vt_contour_private.save_draft(p_paddock_id, p_expected_draft_id, p_expected_revision, p_client_save_id, p_payload)
$$;

create or replace function public.discard_contour_row_mapping_draft(p_paddock_id uuid, p_draft_id uuid, p_expected_revision integer)
returns jsonb language sql volatile security invoker set search_path = pg_catalog as $$
  select vt_contour_private.discard_draft(p_paddock_id, p_draft_id, p_expected_revision)
$$;

revoke all on function public.get_contour_row_mapping_draft(uuid) from public, anon;
revoke all on function public.save_contour_row_mapping_draft(uuid, uuid, integer, uuid, jsonb) from public, anon;
revoke all on function public.discard_contour_row_mapping_draft(uuid, uuid, integer) from public, anon;
grant execute on function public.get_contour_row_mapping_draft(uuid) to authenticated;
grant execute on function public.save_contour_row_mapping_draft(uuid, uuid, integer, uuid, jsonb) to authenticated;
grant execute on function public.discard_contour_row_mapping_draft(uuid, uuid, integer) to authenticated;

commit;
