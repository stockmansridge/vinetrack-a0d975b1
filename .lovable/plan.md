
## Current state of Documents & Exports (audit)

I checked `src/pages/reports/DocumentsPage.tsx` and the database. Today the page is a **launcher**, not a library:

1. **On-demand only.** Every row is built in-memory from the live `trips` and `spray_jobs` tables. PDFs/CSVs are generated client-side at click time (`downloadTripPdf`, `downloadRainfallPdf`, etc.). Nothing is stored.
2. **No stored-file backend.** There is no `documents` / `exported_documents` table in the database, and there are zero Supabase Storage buckets.
3. **No iOS-generated files.** The iOS app does not currently upload generated PDFs/CSVs/XLSX anywhere we read from. The page hard-codes `source: "portal"` for every item; the "Source: iOS" filter exists in the UI but never matches anything.
4. **What's already visible:** Trip Reports (one per trip, all functions), Spray Jobs (per job), Yearly Spray Programs (one per year derived from spray jobs), and Rainfall Reports (on-demand range exports). Spray *Records* are reachable via Reports → Spray Records but are not listed as library rows here.

So today the answer to your four questions is: **(1) yes, (2) no, (3) no, (4) yes for Trip / Spray Job / Yearly Spray / Rainfall, no for individual Spray Records.**

## Proposed direction

Keep every existing on-demand export exactly as-is. Layer a real document-library model on top so anything that gets *uploaded* (from iOS or from a future "save to library" portal action) shows up in the same list, with the same filters and downloads.

### 1. Database — new `exported_documents` table

```text
exported_documents
  id              uuid pk
  vineyard_id     uuid  (FK-equivalent, indexed)
  name            text  not null
  doc_type        text  not null   -- 'trip_report' | 'spray_record'
                                   --  | 'spray_job' | 'yearly_spray_program'
                                   --  | 'rainfall_report' | 'yield_report' | 'other'
  source          text  not null   -- 'ios' | 'portal'
  format          text  not null   -- 'pdf' | 'csv' | 'xlsx'
  storage_path    text  not null   -- 'exported-documents/{vineyard_id}/...'
  size_bytes      bigint
  paddock_id      uuid  null
  related_kind    text  null       -- 'trip' | 'spray_job' | 'spray_record' | ...
  related_id      uuid  null
  created_by      uuid  null       -- auth user id (nullable for iOS service writes)
  operator_name   text  null
  document_date   timestamptz null -- date the underlying record is *for*
  created_at      timestamptz default now()
  deleted_at      timestamptz null
```

Constraints enforced via a `BEFORE INSERT/UPDATE` trigger (not CHECK constraints) so the allowed values for `doc_type`, `source`, `format` can evolve without migration pain.

Indexes on `(vineyard_id, created_at DESC)`, `(vineyard_id, doc_type)`, `(related_kind, related_id)`.

### 2. RLS

- SELECT: any authenticated user who is a `vineyard_members` row for the document's `vineyard_id` (existing membership pattern).
- INSERT: members with role `owner` / `manager` / `worker`; iOS uploads use the same auth user, so RLS just works.
- UPDATE/DELETE: only `owner` / `manager` (soft delete via `deleted_at`).

### 3. Storage bucket — `exported-documents` (private)

- Private bucket; downloads via short-lived signed URLs.
- Path convention: `{vineyard_id}/{doc_type}/{yyyy}/{mm}/{uuid}.{ext}`.
- Storage RLS mirrors the table: read/write only when the first path segment matches a vineyard the user belongs to.

### 4. Portal UI changes (`DocumentsPage.tsx`)

- Add a new query that loads `exported_documents` for the current vineyard and merges those rows into the existing `LibraryItem[]`.
- Stored documents get a real **Download** button that opens a signed URL; on-demand items keep their existing generator buttons. Both share the same row component, filters, and sorting.
- Source filter ("iOS" / "Portal") becomes meaningful — iOS-uploaded files appear with the iOS badge.
- New "Type" options added: **Spray Record**, **Yield Report**, **Other**.
- "Save to library" action added to the existing Trip Report / Rainfall PDF generators (uploads the produced blob to Storage and inserts an `exported_documents` row) — opt-in, does not change current click-to-download behaviour.
- Empty state copy updated to mention iOS uploads will appear once synced.

### 5. iOS / Rork integration (what they need)

The iOS app currently has no path to publish exports. To light up the "Source: iOS" rows:

- Use the same Supabase project credentials already in the app.
- Upload the generated file to Storage at `exported-documents/{vineyard_id}/{doc_type}/{yyyy}/{mm}/{uuid}.{ext}`.
- Insert one row into `public.exported_documents` with `source='ios'`, the storage path, the related `trip_id` / `spray_record_id`, and the operator's name.
- That's it — RLS handles access and the portal will pick the row up automatically.

I'll document this in `docs/ios-document-uploads.md` as part of the change so Rork has a clear contract.

### 6. Out of scope (this round)

- No re-uploading of historical PDFs.
- No batch/zip export.
- No edits to the existing Trip Reports / Spray Records / Rainfall pages.

## Files touched

- **New migration**: `exported_documents` table, validation trigger, RLS policies, `exported-documents` storage bucket + storage policies.
- **New**: `src/lib/exportedDocumentsQuery.ts` (list/insert/sign-url helpers).
- **Edited**: `src/pages/reports/DocumentsPage.tsx` (merge stored docs into library, real download for stored items, "Save to library" on generators).
- **New docs**: `docs/ios-document-uploads.md`.

## Validation

After implementation: `tsc --noEmit`, manual click-through that on-demand Trip/Rainfall/Spray Job exports still work, that an inserted `exported_documents` row appears with a working signed-URL download, and that a non-member cannot read another vineyard's document via direct query or storage URL.

---

If this plan looks right, approve and I'll run the migration first (so types regenerate) and then ship the UI + helpers in a follow-up step. If you'd like the "Save to library" button to be on by default for portal-generated exports rather than opt-in, say so and I'll wire it that way.
