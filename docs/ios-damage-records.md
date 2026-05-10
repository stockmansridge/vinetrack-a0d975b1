# Damage Records — iOS Supabase Schema Extension

> Status: **Proposal for Rork / iOS team.** No changes have been made.
> Audience: the iOS app's Supabase project (`tbafuqwruefgkbyxrxyb`).

The Lovable web portal needs Damage Records to be **manager/owner-creatable from the portal**, in addition to being viewable from iOS. iOS Supabase remains the source of truth — no parallel `damage_records` table will be created in Lovable Cloud.

## 1. Current state (verified via REST probes, May 2026)

`public.damage_records` already exists with the following columns:

```
id            uuid
vineyard_id   uuid
paddock_id    uuid
damage_type   text
notes         text
created_by    uuid
created_at    timestamptz
updated_at    timestamptz
deleted_at    timestamptz
```

RLS is enabled (anon `SELECT` returns 0 rows; anon `INSERT` returns `42501`).

## 2. Required additive migration

All changes are **additive** so they will not break the existing iOS app.

```sql
alter table public.damage_records
  add column if not exists row_number    integer        null,
  add column if not exists side           text           null,  -- 'left' | 'right' | 'both' | 'unknown'
  add column if not exists severity       text           null,  -- 'low' | 'medium' | 'high' | 'severe'
  add column if not exists status         text           not null default 'open',
                                                                -- 'open' | 'monitoring' | 'resolved'
  add column if not exists date_observed  timestamptz    null,
  add column if not exists operator_name  text           null,
  add column if not exists latitude       double precision null,
  add column if not exists longitude      double precision null,
  add column if not exists pin_id         uuid           null,  -- references public.pins(id)
  add column if not exists trip_id        uuid           null,  -- references public.trips(id)
  add column if not exists photo_urls     text[]         null;  -- public URLs from a damage-photos bucket

create index if not exists damage_records_vineyard_observed_idx
  on public.damage_records (vineyard_id, coalesce(date_observed, created_at) desc)
  where deleted_at is null;

create index if not exists damage_records_paddock_idx
  on public.damage_records (paddock_id)
  where deleted_at is null;

create index if not exists damage_records_status_idx
  on public.damage_records (vineyard_id, status)
  where deleted_at is null;
```

### Validation trigger (preferred over CHECK)

Allowed `side`, `severity`, `status` and `damage_type` values are likely to evolve. Enforce them in a `BEFORE INSERT/UPDATE` trigger so the list can be expanded without rewriting CHECK constraints (avoids the typical Supabase restore-failure pattern).

```sql
create or replace function public.damage_records_validate()
returns trigger
language plpgsql
as $$
begin
  if new.side is not null and new.side not in ('left','right','both','unknown') then
    raise exception 'Invalid side: %', new.side;
  end if;
  if new.severity is not null and new.severity not in ('low','medium','high','severe') then
    raise exception 'Invalid severity: %', new.severity;
  end if;
  if new.status is not null and new.status not in ('open','monitoring','resolved') then
    raise exception 'Invalid status: %', new.status;
  end if;
  if new.damage_type is not null and new.damage_type not in (
    'frost','hail','wind','heat_sunburn','disease','pest',
    'machinery','herbicide_chemical','waterlogging','drought',
    'animal_bird','other'
  ) then
    raise exception 'Invalid damage_type: %', new.damage_type;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists damage_records_validate_trg on public.damage_records;
create trigger damage_records_validate_trg
before insert or update on public.damage_records
for each row execute function public.damage_records_validate();
```

### Recommended `damage_type` values

`frost`, `hail`, `wind`, `heat_sunburn`, `disease`, `pest`, `machinery`, `herbicide_chemical`, `waterlogging`, `drought`, `animal_bird`, `other`.

(Stored as snake_case codes; portal renders the friendly label.)

## 3. RLS — keyed off `vineyard_members`

```sql
alter table public.damage_records enable row level security;

drop policy if exists "Members can read damage records" on public.damage_records;
create policy "Members can read damage records"
on public.damage_records
for select
to authenticated
using (
  deleted_at is null
  and exists (
    select 1 from public.vineyard_members vm
    where vm.vineyard_id = damage_records.vineyard_id
      and vm.user_id = auth.uid()
  )
);

drop policy if exists "Members can create damage records" on public.damage_records;
create policy "Members can create damage records"
on public.damage_records
for insert
to authenticated
with check (
  exists (
    select 1 from public.vineyard_members vm
    where vm.vineyard_id = damage_records.vineyard_id
      and vm.user_id = auth.uid()
  )
);

drop policy if exists "Managers can update damage records" on public.damage_records;
create policy "Managers can update damage records"
on public.damage_records
for update
to authenticated
using (
  exists (
    select 1 from public.vineyard_members vm
    where vm.vineyard_id = damage_records.vineyard_id
      and vm.user_id = auth.uid()
      and vm.role in ('owner','manager')
  )
);
```

> Hard `DELETE` is intentionally not exposed. Soft-delete via
> `update damage_records set deleted_at = now()` (covered by the update policy above).

> If a `has_vineyard_role(vineyard_id, role)` security-definer helper already exists in the iOS project, prefer it over inline `EXISTS` to avoid recursive RLS issues.

## 4. Optional — `damage-photos` storage bucket

If photos should be supported, create a private bucket and gate it the same way:

```sql
insert into storage.buckets (id, name, public)
values ('damage-photos','damage-photos', false)
on conflict (id) do nothing;

create policy "Members can read damage photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'damage-photos'
  and exists (
    select 1 from public.vineyard_members vm
    where vm.user_id = auth.uid()
      and vm.vineyard_id::text = (storage.foldername(name))[1]
  )
);

create policy "Members can upload damage photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'damage-photos'
  and exists (
    select 1 from public.vineyard_members vm
    where vm.user_id = auth.uid()
      and vm.vineyard_id::text = (storage.foldername(name))[1]
  )
);
```

Path convention: `{vineyard_id}/{damage_record_id}/{uuid}.jpg`. Store the resulting public URLs (or storage paths) in `damage_records.photo_urls`.

## 5. Portal integration plan (after Rork ships the above)

1. New `src/lib/damageRecordsQuery.ts` — list / create / update / soft-delete via the existing iOS Supabase client.
2. New `src/pages/setup/DamageRecordsPage.tsx`:
   - Filters: paddock, status, severity, damage type, date range, search.
   - Table columns: Date observed · Paddock · Row · Category · Severity · Status · Notes summary · Operator · Photos · Actions.
   - "New damage record" button (managers/owners) opening a sheet with the field set above.
   - Detail/edit drawer with full notes, coordinates, linked pin/trip, photos, created/updated metadata.
3. Sidebar move: under **Work → Damage Records**, removed from "iOS Data (Coming Soon)".

## 6. Open questions for Rork

1. Confirm role names in `vineyard_members.role` (assumed `owner | manager | worker`).
2. Confirm preferred photo bucket strategy — public bucket vs. private + signed URLs.
3. Confirm whether `created_by` should be `not null` (currently nullable).
4. Confirm whether `damage_type` in the iOS app already uses different codes — if so, share the list and I'll reconcile.
