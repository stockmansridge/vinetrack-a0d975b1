# iOS Document Uploads — Implementation Contract

> Status: **Proposal for Rork / iOS team.** No changes have been made to the iOS Supabase project. This document describes the schema, storage bucket and RLS that the Lovable web portal expects so that **Reports → Documents & Exports** can become a true vineyard-wide document library.

## Background

- The Lovable portal reads from the iOS app's Supabase project (`tbafuqwruefgkbyxrxyb`) in read-only mode.
- Lovable Cloud (`qpgkkertfwdycjhcbnpf`) only hosts a small number of edge functions (e.g. `get-mapkit-token`).
- All vineyard data — paddocks, trips, spray records, members, etc. — lives in the iOS project. Document storage should live there too so that:
  - RLS can reuse the existing `vineyard_members` table.
  - iOS and the portal share a single source of truth.
  - The portal can list / download documents with no extra auth bridge.

The portal will keep its current on-demand report generators (Trip, Spray, Yearly Program, Rainfall). This contract adds a *stored* document library on top.

---

## 1. Table — `public.exported_documents`

```sql
create table public.exported_documents (
  id                       uuid primary key default gen_random_uuid(),
  vineyard_id              uuid not null,                  -- references public.vineyards(id)
  paddock_id               uuid null,                      -- references public.paddocks(id)
  related_trip_id          uuid null,                      -- references public.trips(id)
  related_spray_job_id     uuid null,                      -- references public.spray_jobs(id)
  related_spray_record_id  uuid null,                      -- references public.spray_records(id)
  document_type            text not null,                  -- see allowed values below
  source                   text not null,                  -- 'ios' | 'portal'
  format                   text not null,                  -- 'pdf' | 'csv' | 'xlsx'
  name                     text not null,
  storage_path             text not null,                  -- path inside the 'exported-documents' bucket
  file_size_bytes          bigint null,
  created_by               uuid null,                      -- auth.users(id) of uploader (nullable for service writes)
  operator_name            text null,                      -- friendly operator name when no auth user
  document_date            timestamptz null,               -- date the underlying record is *for* (e.g. trip start_time)
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz null
);

create index exported_documents_vineyard_created_idx
  on public.exported_documents (vineyard_id, created_at desc)
  where deleted_at is null;

create index exported_documents_type_idx
  on public.exported_documents (vineyard_id, document_type)
  where deleted_at is null;

create index exported_documents_related_trip_idx
  on public.exported_documents (related_trip_id)
  where related_trip_id is not null;

create index exported_documents_related_spray_job_idx
  on public.exported_documents (related_spray_job_id)
  where related_spray_job_id is not null;

create index exported_documents_related_spray_record_idx
  on public.exported_documents (related_spray_record_id)
  where related_spray_record_id is not null;
```

### Allowed `document_type` values

- `trip_report`
- `spray_record`
- `spray_job`
- `yearly_spray_program`
- `rainfall_report`
- `yield_report`
- `damage_report`
- `growth_stage_report`
- `other`

### Allowed `source` values

- `ios` — uploaded by the iOS app
- `portal` — uploaded by the Lovable web portal

### Allowed `format` values

- `pdf`
- `csv`
- `xlsx`

### Validation — use a trigger, not CHECK constraints

The allowed values above will evolve. Enforce them in a `BEFORE INSERT OR UPDATE` trigger so the list can be changed without rewriting CHECK constraints (avoids the typical Supabase restore-failure pattern):

```sql
create or replace function public.exported_documents_validate()
returns trigger
language plpgsql
as $$
begin
  if new.document_type not in (
    'trip_report','spray_record','spray_job','yearly_spray_program',
    'rainfall_report','yield_report','damage_report','growth_stage_report','other'
  ) then
    raise exception 'Invalid document_type: %', new.document_type;
  end if;
  if new.source not in ('ios','portal') then
    raise exception 'Invalid source: %', new.source;
  end if;
  if new.format not in ('pdf','csv','xlsx') then
    raise exception 'Invalid format: %', new.format;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create trigger exported_documents_validate_trg
before insert or update on public.exported_documents
for each row execute function public.exported_documents_validate();
```

---

## 2. RLS — keyed off existing `vineyard_members`

```sql
alter table public.exported_documents enable row level security;

-- SELECT: any member of the vineyard
create policy "Members can read documents for their vineyard"
on public.exported_documents
for select
to authenticated
using (
  exists (
    select 1 from public.vineyard_members vm
    where vm.vineyard_id = exported_documents.vineyard_id
      and vm.user_id = auth.uid()
  )
  and deleted_at is null
);

-- INSERT: any member can upload (worker / manager / owner)
create policy "Members can upload documents for their vineyard"
on public.exported_documents
for insert
to authenticated
with check (
  exists (
    select 1 from public.vineyard_members vm
    where vm.vineyard_id = exported_documents.vineyard_id
      and vm.user_id = auth.uid()
  )
);

-- UPDATE / soft-delete: managers and owners only
create policy "Managers can update documents for their vineyard"
on public.exported_documents
for update
to authenticated
using (
  exists (
    select 1 from public.vineyard_members vm
    where vm.vineyard_id = exported_documents.vineyard_id
      and vm.user_id = auth.uid()
      and vm.role in ('owner','manager')
  )
);
```

> If the iOS project already has a `has_vineyard_role(vineyard_id, role)` security-definer helper, prefer that to inline `EXISTS` to avoid recursive RLS issues.

Hard `DELETE` is intentionally not exposed to clients — use `update set deleted_at = now()` instead.

---

## 3. Storage bucket — `exported-documents`

```sql
insert into storage.buckets (id, name, public)
values ('exported-documents', 'exported-documents', false);
```

**Private bucket.** Downloads happen via short-lived signed URLs (e.g. 60s) created by the client after listing rows from `exported_documents`.

### Path convention

```
{vineyard_id}/{document_type}/{yyyy}/{mm}/{uuid}.{ext}
```

The first path segment **must** be the `vineyard_id`. Storage RLS uses that segment to gate access. The same string is what goes into `exported_documents.storage_path`.

### Storage policies (on `storage.objects`)

```sql
-- Read
create policy "Members can read exported documents for their vineyard"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'exported-documents'
  and exists (
    select 1 from public.vineyard_members vm
    where vm.user_id = auth.uid()
      and vm.vineyard_id::text = (storage.foldername(name))[1]
  )
);

-- Upload
create policy "Members can upload exported documents for their vineyard"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'exported-documents'
  and exists (
    select 1 from public.vineyard_members vm
    where vm.user_id = auth.uid()
      and vm.vineyard_id::text = (storage.foldername(name))[1]
  )
);

-- Delete (managers/owners only)
create policy "Managers can delete exported documents for their vineyard"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'exported-documents'
  and exists (
    select 1 from public.vineyard_members vm
    where vm.user_id = auth.uid()
      and vm.vineyard_id::text = (storage.foldername(name))[1]
      and vm.role in ('owner','manager')
  )
);
```

---

## 4. iOS upload flow

After generating a PDF / CSV / XLSX in the iOS app:

1. Build the storage path:
   ```
   {vineyard_id}/{document_type}/{yyyy}/{mm}/{new uuid}.{ext}
   ```
2. Upload the file bytes to bucket `exported-documents` at that path.
3. Insert a row into `public.exported_documents`:
   ```jsonc
   {
     "vineyard_id": "…",
     "paddock_id": "…",                  // if relevant
     "related_trip_id": "…",             // if a trip report
     "related_spray_record_id": "…",     // if a spray record
     "document_type": "trip_report",
     "source": "ios",
     "format": "pdf",
     "name": "Trip Report — Block 3 — 2026-05-09",
     "storage_path": "<the path used above>",
     "file_size_bytes": 184231,
     "operator_name": "James Smith",
     "document_date": "2026-05-09T07:30:00Z"
   }
   ```
4. RLS handles the rest — the row only becomes visible to members of that vineyard, and the file is only readable to the same group.

No further coordination is needed for it to appear in the portal: as soon as the row exists, the portal will list and offer it for download.

---

## 5. Portal integration plan (after Rork ships the above)

1. Add `src/lib/exportedDocumentsQuery.ts` to the portal:
   - `listExportedDocuments(vineyardId, filters)` — selects from `exported_documents` (deleted_at is null).
   - `signedUrlFor(storage_path)` — calls Storage `createSignedUrl(60)`.
2. `src/pages/reports/DocumentsPage.tsx` merges those rows into the existing `LibraryItem[]` so on-demand and stored items share filters, sorting and the same row UI. Stored items get a real **Download** button (signed URL); on-demand items keep their generators.
3. The "Source" filter ("iOS" / "Portal") becomes meaningful — iOS-uploaded files appear with the iOS badge.
4. `document_type` adds **Spray Record**, **Yield Report**, **Damage Report**, **Growth Stage Report**, **Other** to the type filter.
5. Optional follow-up: add a "Save to library" button on the existing Trip Report / Rainfall / Spray Job generators that uploads the produced blob to the same bucket with `source = 'portal'`. Requires the portal client to authenticate against the iOS Supabase project (it already does for reads) and the same RLS to permit member inserts.

Until those changes ship, the portal will keep generating reports on demand exactly as it does today and will display the banner:

> *iOS-uploaded documents will appear here once document storage is enabled.*

---

## 6. Out of scope (this contract)

- Re-uploading historical PDFs.
- Batch / zip downloads.
- Edge functions for proxying downloads (signed URLs are sufficient).
- Versioning of the same logical document (replace by uploading a new row; keep old rows soft-deleted if needed).

---

## 7. Open questions for Rork

1. Does a `has_vineyard_role(vineyard_id, role)` security-definer helper already exist? If so, we'll use it in the policies above to avoid `EXISTS` boilerplate.
2. Should the portal be allowed to write `source = 'portal'` rows immediately, or do you want to gate that behind a manager-only policy?
3. Confirm the role names in `vineyard_members.role` — this contract assumes `'owner' | 'manager' | 'worker'`.
4. Confirm preferred file size cap for the bucket (suggest 25 MB per object).
