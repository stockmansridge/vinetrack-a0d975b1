-- 253 — Reject non-whole physical row numbers in paddocks.rows
-- ============================================================================
-- TARGET: canonical VineTrack database (tbafuqwruefgkbyxrxyb). NOT Lovable Cloud.
-- STATUS: HANDOFF — NOT APPLIED. For Rork review/application.
-- Before applying, confirm 253 is still the next free number in the shared
-- sequence and that no equivalent paddocks.rows validator already exists
-- (see diagnostic query D1 below).
--
-- WHY: get_pruning_vineyard_summary casts rows[*].number to integer and fails
-- with `invalid input syntax for type integer: "1.5"` when a physical row
-- number is fractional (Garland Viticultural, block "3DROPS NEB").
--
-- RULES (physical block rows only — NOT trip paths/aisles, offsets, spacing):
--   * rows[*].number, when present, must be a JSON number that is a whole
--     number in 1..2147483647 (spec: "any positive integer", int4 cast).
--   * NULL / empty arrays stay allowed (drafts). Elements without a `number`
--     key are left to existing rules (not tightened here).
--   * Values are never rounded or rewritten — the write is rejected.
--   * UPDATEs only validate when `rows` actually changes, so metadata-only
--     edits on blocks with legacy invalid data keep working.
-- No RLS, grants, JSON shape or sync columns are changed.
-- ============================================================================

create or replace function public.paddocks_validate_physical_row_numbers()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_bad jsonb;
begin
  if new.rows is null or jsonb_typeof(new.rows) <> 'array' or jsonb_array_length(new.rows) = 0 then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.rows is not distinct from old.rows then
    return new;
  end if;

  select e -> 'number' into v_bad
    from jsonb_array_elements(new.rows) e
   where e ? 'number'
     and (
       jsonb_typeof(e -> 'number') <> 'number'
       or (e ->> 'number')::numeric <> trunc((e ->> 'number')::numeric)
       or (e ->> 'number')::numeric < 1
       or (e ->> 'number')::numeric > 2147483647
     )
   limit 1;

  if v_bad is not null then
    raise exception 'Physical row numbers must be whole numbers (found %)', v_bad
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists paddocks_validate_physical_row_numbers on public.paddocks;
create trigger paddocks_validate_physical_row_numbers
  before insert or update of rows on public.paddocks
  for each row execute function public.paddocks_validate_physical_row_numbers();

-- ============================================================================
-- READ-ONLY DIAGNOSTICS (run separately; change nothing)
-- ============================================================================
-- D1: existing triggers/constraints on paddocks
-- select tgname, pg_get_triggerdef(t.oid) from pg_trigger t
--  where tgrelid = 'public.paddocks'::regclass and not tgisinternal;
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'public.paddocks'::regclass;
--
-- D2: Garland Viticultural invalid physical rows (block, row UUID, number,
--     array position, audit metadata)
-- select p.id as block_id, p.name, e.ord - 1 as array_index,
--        e.row ->> 'id' as row_id, e.row -> 'number' as stored_number,
--        p.created_at, p.updated_at, p.client_updated_at, p.updated_by
--   from public.paddocks p
--   cross join lateral jsonb_array_elements(p.rows) with ordinality as e(row, ord)
--  where p.vineyard_id = '14637991-09aa-4838-a75f-1978e549ffa3'
--    and p.deleted_at is null
--    and e.row ? 'number'
--    and (jsonb_typeof(e.row -> 'number') <> 'number'
--         or (e.row ->> 'number')::numeric <> trunc((e.row ->> 'number')::numeric))
--  order by p.name, e.ord;
--
-- D3: full numbering context of each affected block (to confirm intent
--     before any repair — do NOT assume 1.5 -> 1 or 2)
-- select p.name, e.ord - 1 as array_index, e.row ->> 'id' as row_id, e.row -> 'number' as number
--   from public.paddocks p
--   cross join lateral jsonb_array_elements(p.rows) with ordinality as e(row, ord)
--  where p.id in (<affected block ids from D2>)
--  order by p.name, e.ord;
--
-- D4: platform-wide count (information only — do not bulk repair)
-- select count(distinct p.id) as blocks, count(*) as bad_rows
--   from public.paddocks p
--   cross join lateral jsonb_array_elements(p.rows) e
--  where jsonb_typeof(p.rows) = 'array' and e ? 'number'
--    and jsonb_typeof(e -> 'number') = 'number'
--    and (e ->> 'number')::numeric <> trunc((e ->> 'number')::numeric);
