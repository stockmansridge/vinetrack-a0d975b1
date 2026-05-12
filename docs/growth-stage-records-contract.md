# Growth Stage Records — Contract Doc for Rork

> Status: **portal page is live and read-only**, sourced from the existing
> `pins` table. This document records the gaps that prevent a richer
> Growth Stage experience and proposes a path forward. No portal changes
> are blocked on this — the sections below are for the iOS / Supabase
> team's planning.

## Today's source on the iOS Supabase project

There is **no dedicated growth-stage-records table**. Field growth
observations are stored as `pins` rows where either:

- `pins.mode = 'Growth'`, or
- `pins.growth_stage_code IS NOT NULL`

Relevant fields used by `/reports/growth-stage`:

| Pin column | Purpose | Notes |
| --- | --- | --- |
| `id` | record id | uuid |
| `vineyard_id` | scope | required |
| `paddock_id` | block link | nullable on legacy rows |
| `mode` | classifier | `'Growth'` for growth observations |
| `growth_stage_code` | E-L code | text, e.g. `"7"`, `"23"` |
| `notes` | free text | |
| `photo_path` | single photo | bucket `vineyard-pin-photos` |
| `latitude` / `longitude` | location | |
| `row_number` / `side` | location | |
| `completed_at` / `created_at` | observation date | portal uses `completed_at ?? created_at` |
| `created_by` / `updated_by` | operator | uuid → resolved via `get_vineyard_team_members` RPC |
| `client_updated_at` / `sync_version` / `deleted_at` | sync | standard pattern |

Variety is **not on the pin**; the portal infers it from
`paddocks.variety_allocations[0].variety` for the linked block.

## Gaps

1. **No explicit "growth stage" record type.** Filtering on
   `mode = 'Growth' OR growth_stage_code IS NOT NULL` works, but mixes
   intent with other pin records that happen to carry an E-L code.
2. **Single photo per record.** Growth observations often warrant
   multiple photos (canopy, bunch zone, close-up). `pins.photo_path`
   only holds one path.
3. **No E-L stage label/description column.** Only the numeric code is
   stored; the portal has no source of truth for the textual stage name
   ("Woolly bud", "Flowering 50%", "Veraison", etc.).
4. **No variety on the observation.** Mixed-variety blocks cannot be
   differentiated. The portal currently shows the block's first variety
   allocation.
5. **No operator/operator_role fields.** Only the auth `created_by`
   uuid; the portal resolves names via the team lookup RPC.
6. **No structured "stage scope".** No way to record "applies to whole
   block" vs "applies to row 12 only" beyond the pin's row metadata.

## Recommended path (for Rork to consider)

A dedicated `growth_stage_records` table would clean this up. Suggested
shape (mirrors existing iOS sync conventions):

```sql
create table public.growth_stage_records (
  id uuid primary key default gen_random_uuid(),
  vineyard_id uuid not null references public.vineyards(id) on delete cascade,
  paddock_id  uuid not null references public.paddocks(id)  on delete cascade,
  variety text,                               -- snapshot at observation time
  date date not null,
  el_stage_code text not null,                -- e.g. "23"
  el_stage_label text,                        -- e.g. "Flowering 50%"
  notes text,
  photo_paths text[] default '{}',            -- multiple photos
  scope text,                                 -- 'block' | 'row' | 'point'
  row_number int,
  side text,
  latitude double precision,
  longitude double precision,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_updated_at timestamptz,
  sync_version int not null default 1
);
```

RLS: same operational-roles model as `pins` /
`maintenance_logs`. Soft-delete RPC: `soft_delete_growth_stage_record(p_id)`
(owner / manager / supervisor only).

Photos: continue to use the `vineyard-pin-photos` bucket (or a new
`vineyard-growth-stage-photos` bucket) — paths stored in `photo_paths`.

## Portal commitments once the table lands

When `growth_stage_records` is live:

1. Switch `src/lib/growthStageRecordsQuery.ts` from `pins` to the new
   table (keep a small fallback that still includes legacy growth pins
   for ~one season).
2. Show all photos in the detail drawer, not just one.
3. Show `el_stage_label` alongside the code when present.
4. Add the variety column directly from the record (no paddock
   inference).
5. Optionally add portal write support gated on owner / manager /
   supervisor roles — to mirror Maintenance Logs.

Until then, the portal will continue to read from `pins` and degrade
gracefully when fields are missing.
