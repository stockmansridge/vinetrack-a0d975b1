# Contour Row Mapping (Beta) — Round 1 contract (revision 2)

Status: Portal pilot, System Admin only. Drafts are **review-only** and never
write `paddocks.rows`, `row_direction`, `row_width`, `row_count`,
`polygon_points`, `row_length_override`, vine overrides or any operational input.
Activation into real rows is a later phase.

## Storage
Defined in `sql/contour_row_mapping_round1_PENDING.sql` (**not applied** — Rork
assigns the number and applies). Verification: `sql/contour_row_mapping_round1_VERIFY_rollback.sql`
(rollback-only). Tables live in the private schema `vt_contour_private`
(no grants, RLS on, no policies):

- `drafts` — one slot per block. The slot survives discard (`draft_id`/`payload`
  NULL) and its `revision` only ever increases, so revisions never reset.
- `discarded_drafts` — tombstone per discarded `draft_id`; that id can never be
  saved or discarded again.
- `saves` — every accepted `client_save_id` with block, draft, revision and
  `md5(payload::text)` (jsonb text is key-order canonical).

Public API = `SECURITY INVOKER` wrappers over narrowly granted
`SECURITY DEFINER` functions in the private schema (`search_path` pinned):

| RPC | Returns |
| --- | --- |
| `get_contour_row_mapping_draft(p_paddock_id)` | `null` (never saved) · `{draft_id:null, payload:null, revision}` (discarded) · `{draft_id, revision, payload, last_client_save_id, updated_at, updated_by}` |
| `save_contour_row_mapping_draft(p_paddock_id, p_expected_draft_id, p_expected_revision, p_client_save_id, p_payload)` | `{draft_id, revision, client_save_id, replayed}` |
| `discard_contour_row_mapping_draft(p_paddock_id, p_draft_id, p_expected_revision)` | `{revision, already_discarded}` |

### Authorisation
`auth.uid()` not null AND `is_system_admin()` AND `is_vineyard_member(vineyard)`
(owner-of-record OR member row) for the block's vineyard, derived server-side;
block and vineyard must have `deleted_at IS NULL`. `get_my_vineyard_access` is
not used (it is an operational entitlement decision).

### Save rules
- Non-null `p_expected_revision >= 0` and non-null `p_client_save_id` required.
- All saves/discards for a block are serialised by a transaction advisory lock
  on the block id (no lock on `paddocks`), so two first saves cannot race.
- Replay: a known `client_save_id` with the same block/draft/content returns the
  original acknowledgement (`replayed: true`); different content →
  `invalid_client_save_id_reused`.
- Payload `draftId` in tombstones → `stale_draft_discarded`.
- No slot: expected must be `(null, 0)`. Discarded slot: `(null, slot.revision)`.
  Live slot: `(slot.draft_id, slot.revision)` and payload `draftId` must match.
  Otherwise `stale_revision`.
- Portal confirms a save only when the ack carries our save id and draft id and
  the read-back shows exactly that revision, `last_client_save_id` and
  (order-insensitively) equal payload. A later revision on read-back is a
  **conflict**: local edits are kept; the other writer's payload is never shown
  as ours. Network failures are retried with the same save id.

### Discard rules
Idempotent per `draft_id` (repeat → `already_discarded: true`, never touches a
replacement). Otherwise requires matching live `draft_id` and revision.

## Payload (`schema = "vinetrack.contour_row_mapping_draft"`, `version = 1`)
```
{ draftId, vineyardId, paddockId,
  groups: [{ id, name(<=120), mode: "straight"|"contour"|"imported",
             referenceTrace: [{lat,lng}] (0..500), smoothing: 0|1|2,
             spacingM: 0.5..20, startNumber: 1..100000, ascending: bool,
             leftCount/rightCount: 0..300, extendToArea: bool,
             workingArea: [{lat,lng}] (3..500) | null,
             exclusions: [{ id, points: [{lat,lng}] (3..500) }] (<=50),
             rows: [{ id, number: 1..100000 (unique per draft),
                      offsetIndex: -300..300 | null,
                      provenance: "generated"|"edited"|"imported",
                      canonicalRowId: uuid|null,   // must be an id in this block's paddocks.rows
                      source: object|null (<=2 KB),
                      parts: [{ id, points: [{lat,lng}] (2..2000, non-zero length) }] (1..50) }] }] }
```
- All ids are UUIDs, unique across the whole draft. Limits: 50 groups, 2000 rows,
  200 000 points, 4 MB compact JSON (SQL allows 1.5× for jsonb spacing; same for
  per-row 200 KB, trace/mask 60 KB).
- **In-progress rule:** an empty draft and groups with no rows and a partial
  trace are valid and savable. Unfinished working areas / cut-outs (< 3 points)
  are not — finish or remove them first.
- Coordinates: WGS84 `{lat, lng}` numbers within range (never strings/null).
- A row is ONE logical physical row; `parts` are disjoint pieces. Length = sum
  of parts; gaps never count; parts are never bridged or flattened.
- Loaded payloads are validated (shape + scope) before rendering; canonical
  links to rows no longer in the block are flagged in the editor (save blocked
  until cleared) so a block change can't lock a draft.

## Geometry (Portal, before save and before any import is committed)
Block-local equirectangular projection (metres). Errors block save:
self-crossing or doubling back, parts of a row touching, rows crossing,
touching or collinearly overlapping, repeated points / zero-length parts,
vertices or segment midpoints > 1 m outside the block, outside a group's
working area or inside a cut-out (non-imported groups), invalid working
areas / cut-outs (< 3 points, no area, self-crossing). A 10 m segment grid
limits comparisons; > 3 M pair tests is reported as "too complex".
The server enforces structure only (no PostGIS dependency).

## Imports
- GeoJSON: numeric finite `[lng, lat(, alt)]` only; FeatureCollection must
  have a `features` array of Features; empty MultiLineString rejected; CRS
  accepted only as CRS84/EPSG:4326 at any level.
- KML: each tuple must be 2–3 non-blank numeric components; DOCTYPE/ENTITY
  rejected; NetworkLinks never fetched.
- Files > 5 MB are rejected before reading. Lines > 100 m outside the block are rejected.

## Identity
- Regeneration keeps row/part ids by `offsetIndex`.
- Backup (`vinetrack.contour_row_mapping_export`, v1), explicit choice:
  - **Restore into this draft** — only when the backup's draft/block/vineyard
    match; every id kept.
  - **Import as new copy** — group, mask, row and part ids regenerated and
    `canonicalRowId` cleared. The draft container id stays the block's current
    `draftId`, because one block holds one draft and the save must target it.

## Editor
State is keyed by user + selected vineyard + block (+ reload/discard nonce).
During save/discard every mutation is frozen (guarded handlers + disabled
controls); after a confirmed save the editor is not remounted. Unsaved
changes are protected on browser unload and in-app link clicks.

## Future activation (later phase)
Applying a draft to real rows must preserve existing `paddocks.rows` ids via
explicit `canonicalRowId`, coordinated with iOS/Android and SQL row-identity guards.
