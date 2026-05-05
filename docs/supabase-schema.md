# VineTrack — Supabase Schema Reference (canonical)

> **Read-only documentation.** This file is the canonical schema reference for the
> Lovable web admin portal. It is hand-curated from (a) the iOS app SQL migrations
> (sql/001–021) supplied by Rork, and (b) live PostgREST probing of the connected
> Supabase project. **Do not modify the database, run migrations, or change RLS
> based on this document — it describes the existing production schema only.**

## Connection

- **Project URL**: `https://tbafuqwruefgkbyxrxyb.supabase.co`
- **Project ref**: `tbafuqwruefgkbyxrxyb`
- **Web portal access**: anon key only (browser). Service-role key MUST NEVER be
  used in client code. RLS is the authority for visibility.

---

## Lovable portal read-only guidance

- Use **existing tables only**. No new tables, no migrations, no RLS edits.
- **No writes** in the MVP — no `insert / update / delete / upsert`, no
  write-style `rpc()` calls.
- Anon key only; rely on RLS for vineyard-scoped visibility, but always also
  apply explicit `.eq("vineyard_id", selectedVineyardId)` filters and
  `.is("deleted_at", null)` for soft-deleted tables.
- Hide a column in the UI **only if it is genuinely not useful** to an owner /
  manager — never because we failed to probe it. When in doubt, surface it on
  the detail view and omit from the list view.
- Treat columns marked "local-only" or "device cache" as not present in
  Supabase — do not query them.
- `vineyard_weather_integrations` MUST NOT be queried from the browser. Use the
  `get_vineyard_weather_integration` RPC. **Never** read or render `api_secret`.

---

## Common columns (most tables)

| Column          | Type        | Notes                                             |
|-----------------|-------------|---------------------------------------------------|
| `id`            | uuid        | Primary key                                       |
| `vineyard_id`   | uuid        | FK → `vineyards.id`, multi-tenant scope           |
| `created_at`    | timestamptz | Server insert time                                |
| `updated_at`    | timestamptz | Server update time                                |
| `deleted_at`    | timestamptz | Soft-delete marker; filter `IS NULL` in portal    |
| `sync_version`  | bigint      | Monotonic sync counter used by iOS offline sync   |
| `created_by`    | uuid        | FK → `auth.users.id`                              |
| `updated_by`    | uuid        | FK → `auth.users.id`                              |

These are referred to below as **[std audit/sync]**.

---

## Tables

### `vineyards`

- **Purpose**: Top-level tenant record. One per physical vineyard operation.
- **PK**: `id`
- **Confirmed columns**: `id`, `name`, `owner_id`, `country`, [std audit/sync].
- **Likely additional columns from iOS schema** (not all probed; surface in
  detail view if returned by `select *`): `address`, `region`, `timezone`,
  `default_unit`, `settings` (jsonb), `metadata` (jsonb).
- **RLS**: Visible to authenticated users with a row in `vineyard_members` for
  this vineyard.
- **iOS DTO**: `Vineyard` model.

### `vineyard_members`

- **Purpose**: Per-vineyard role assignments.
- **PK**: `id`
- **FKs**: `vineyard_id` → `vineyards.id`, `user_id` → `auth.users.id`
- **Confirmed columns**: `id`, `vineyard_id`, `user_id`, `role`, `joined_at`,
  `created_at`, `updated_at`, `deleted_at`.
- **`role` values**: `owner | manager | operator` (operators blocked from web
  portal at login).
- **RLS**: A user can read membership rows for vineyards where they themselves
  are a member.
- **iOS DTO**: `VineyardMember`.

### `profiles`

- **Purpose**: Public-facing user profile data joined to `auth.users`.
- **PK**: `id` (= `auth.users.id`)
- **Confirmed columns**: `id`, `display_name`, `full_name`, `email`,
  `avatar_url`, `created_at`, `updated_at`.
- **RLS**: Readable for users who share at least one vineyard membership.
- **iOS DTO**: `Profile`.

### `invitations`

- **Purpose**: Pending vineyard invites.
- **Confirmed columns**: `id`, `vineyard_id`, `email`, `role`, `status`,
  `token`, `expires_at`, `invited_by`, `created_at`, `updated_at`,
  `deleted_at`, `sync_version`, `created_by`, `updated_by`, `notes`.
- **RLS**: Visible to owner/manager of the vineyard.

---

### `paddocks` (full inventory)

- **Purpose**: Vineyard blocks/paddocks with geometry, row layout, irrigation
  parameters, phenology dates, and per-paddock calculation overrides.
- **PK**: `id`
- **FK**: `vineyard_id` → `vineyards.id`
- **Confirmed columns**:
  - Identity / scope: `id`, `vineyard_id`, `name`
  - Geometry: `polygon_points` (jsonb — array of `{lat, lng}` boundary points)
  - Row layout: `rows` (jsonb — array of row geometry/metadata; canonical row
    inventory used to derive row count and per-row length)
  - Variety mix: `variety_allocations` (jsonb — array of
    `{variety, percent | rows | row_ids, …}`; cultivar split for the paddock)
  - Row spacing & orientation:
    - `row_direction` (degrees / enum)
    - `row_width` (metres between adjacent rows)
    - `row_offset` (metres; offset of first row from boundary)
    - `intermediate_post_spacing` (metres between intermediate posts within a row)
  - Vine spacing & counts:
    - `vine_spacing` (metres between vines along a row)
    - `vine_count_override` (manual override; when set, takes precedence over
      derived count)
    - `row_length_override` (manual override of derived row length)
  - Irrigation:
    - `flow_per_emitter` (litres / hour)
    - `emitter_spacing` (metres between drippers)
  - Phenology dates (per-season): `budburst_date`, `flowering_date`,
    `veraison_date`, `harvest_date`
  - Planting: `planting_year`
  - Calculation overrides:
    - `calculation_mode_override` (forces a specific area/vine-count
      calculation strategy when set; otherwise vineyard default applies)
    - `reset_mode_override` (controls per-season reset behaviour for phenology
      and counters)
  - [std audit/sync]: `created_at`, `updated_at`, `deleted_at`,
    `sync_version`, `created_by`, `updated_by`
- **Probed and confirmed NOT present**: `notes`, `description`, `area`,
  `area_hectares`, `variety`, `varietal`, `block_id`, `last_synced_at`.
- **Computed (derived; do not store)**:
  - **Area** — derived from `polygon_points` (planar area of the polygon, in
    hectares). Not a column.
  - **Row count** — `rows.length` from the `rows` JSON.
  - **Vine count** — derived from `rows` + `vine_spacing` (per-row length /
    `vine_spacing`, summed). When `vine_count_override` is set, that value
    wins. When `row_length_override` is set, it overrides the per-row length
    used in this calculation.
- **RLS**: Visible to vineyard members.
- **iOS DTO**: `Paddock` model.

### `tractors`

- **Purpose**: Tractor inventory.
- **PK**: `id`; **FK**: `vineyard_id`.
- **Confirmed columns**: `id`, `vineyard_id`, `name`, `model`, [std audit/sync].
- **Probed not present** (in the web schema currently exposed): `make`,
  `manufacturer`, `year`, `registration`, `serial_number`, `status`, `notes`,
  `hours_used`, `purchase_date`. The iOS app may carry richer data locally.
- **RLS**: Vineyard members.
- **iOS DTO**: `Tractor`.

### `spray_equipment`

- **Purpose**: Sprayers and related equipment.
- **PK**: `id`; **FK**: `vineyard_id`.
- **Confirmed columns**: `id`, `vineyard_id`, `name`, `tank_capacity_litres`,
  [std audit/sync].
- **Probed not present**: `type`, `capacity`, `width_metres`, `nozzle_count`,
  `nozzle_type`, `pump_type`, `status`, `notes`.
- **RLS**: Vineyard members.

### `spray_records`

- **Purpose**: Individual spray applications (read-only preview in MVP).
- **Confirmed columns**: `id`, `vineyard_id`, `date`, `start_time`,
  `end_time`, `temperature`, `humidity`, `wind_speed`, `wind_direction`,
  `notes`, [std audit/sync].
- Likely additional FKs in iOS schema (not surfaced in current probe):
  `paddock_id`, `tractor_id`, `equipment_id`, `chemical_id`, `operator_id`.
  Treat these as may-be-present; rely on `select *` and render whatever is
  returned.
- **RLS**: Vineyard members.

### `work_tasks`

- **Confirmed columns**: `id`, `vineyard_id`, `paddock_id`, `date`,
  `task_type`, `notes`, [std audit/sync].
- **RLS**: Vineyard members.

### `maintenance_logs`

- **Confirmed columns**: `id`, `vineyard_id`, `date`, [std audit/sync].
- **RLS**: Vineyard members.

### `saved_chemicals`

- **Confirmed columns**: `id`, `vineyard_id`, `name`, `active_ingredient`,
  `rate_per_ha`, `unit`, `notes`, [std audit/sync].
- **RLS**: Vineyard members.

### `saved_spray_presets`

- **Confirmed columns**: `id`, `vineyard_id`, `name`, [std audit/sync].
- **RLS**: Vineyard members.

### `operator_categories`

- **Confirmed columns**: `id`, `vineyard_id`, `name`, [std audit/sync].
- **RLS**: Vineyard members.

### `pins`

- **Purpose**: Map pins (issues, points of interest).
- **Confirmed columns**: `id`, `vineyard_id`, `title`, `latitude`, `longitude`,
  `paddock_id`, `category`, `status`, `notes`, [std audit/sync].
- **RLS**: Vineyard members.

### `trips`

- **Purpose**: GPS trips (tractor passes).
- **Confirmed columns**: `id`, `vineyard_id`, `paddock_id`, `start_time`,
  `end_time`, [std audit/sync].
- **RLS**: Vineyard members.

### `historical_yield_records`

- **Confirmed columns**: `id`, `vineyard_id`, `notes`, [std audit/sync].
- **RLS**: Vineyard members.

---

### `vineyard_weather_integrations` (RPC-only)

- **Purpose**: Per-vineyard third-party weather provider credentials
  (provider, station id, API key/secret).
- **DIRECT ACCESS DENIED for `anon`** — confirmed `42501 permission denied`.
- **Access pattern**: call the `get_vineyard_weather_integration(vineyard_id)`
  RPC, which returns a redacted view safe for clients.
- **`api_secret` MUST NEVER be exposed** in the portal UI or in logs, even if
  the RPC ever returned it. Treat the field as forbidden in the browser.
- The Lovable portal currently does **not** call this RPC. If a future phase
  needs it, it must do so via the RPC only and render the redacted shape.

---

## Intentionally local-only / device-only data

The iOS app maintains some state that is **not** in the Supabase schema and
must not be invented in the portal:

- Local map tile caches and offline imagery
- Device GPS smoothing buffers
- In-flight sync queues / retry counters
- User-device UI preferences (selected map layer, last-opened tab, etc.)
- Local draft records prior to first sync

If a field looks expected but is missing from the live schema probe, assume it
is local-only and surface nothing rather than guessing.

---

## Soft-delete tables

The following tables expose `deleted_at` and the portal filters them out:
`vineyards`, `vineyard_members`, `profiles` (n/a — no deleted_at on auth),
`paddocks`, `tractors`, `spray_equipment`, `spray_records`, `work_tasks`,
`maintenance_logs`, `saved_chemicals`, `saved_spray_presets`,
`operator_categories`, `pins`, `trips`, `invitations`,
`historical_yield_records`.

## Sync semantics (informational)

- `sync_version` is a monotonically increasing per-row counter used by the iOS
  offline-first sync layer. The web portal must not write to it.
- `created_by` / `updated_by` reference `auth.users.id`. Join via `profiles`
  for display.

---

## Change log

- **v1 (this file)** — Initial canonical reference. Built from Rork's iOS
  schema audit + live PostgREST probing of project
  `tbafuqwruefgkbyxrxyb`. Read-only; no DB changes performed.
