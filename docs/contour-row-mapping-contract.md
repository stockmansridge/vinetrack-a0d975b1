# Contour Row Mapping (Beta) — Round 1 contract

Status: Portal pilot, System Admin only. Drafts are **review-only** and never
write `paddocks.rows`, `row_direction`, `row_width`, `row_count`,
`polygon_points`, `row_length_override`, vine overrides or any operational input.
Activation into real rows is a later phase.

## Storage
`public.contour_row_mapping_drafts` (one draft per block), defined in
`sql/contour_row_mapping_round1_PENDING.sql` (**not applied** — Rork assigns the
number and applies). No table grants; access only through:

| RPC | Purpose |
| --- | --- |
| `get_contour_row_mapping_draft(p_paddock_id)` | `{revision, payload, updated_at, updated_by}` or `null` |
| `save_contour_row_mapping_draft(p_paddock_id, p_expected_revision, p_client_save_id, p_payload)` | atomic upsert; `stale_revision` on mismatch; same `client_save_id` retried after success returns the stored result |
| `discard_contour_row_mapping_draft(p_paddock_id, p_expected_revision)` | delete with revision check |

Authorisation (read and write): `is_system_admin()` AND membership of the
block's vineyard (vineyard derived server-side from `paddocks`). Author and
revision are server-controlled. Payload validated server-side (schema version,
scope, sizes, unique ids, unique row numbers, ≥2 points per part, WGS84 ranges).

## Payload (`schema = "vinetrack.contour_row_mapping_draft"`, `version = 1`)
```
{ draftId, vineyardId, paddockId,
  groups: [{ id, name, mode: "straight"|"contour"|"imported",
             referenceTrace: [{lat,lng}], smoothing: 0..2,
             spacingM, startNumber, ascending, leftCount, rightCount, extendToArea,
             workingArea: [{lat,lng}] | null,           // open polygon, inside block
             exclusions: [{ id, points: [{lat,lng}] }],  // tracks/obstacles
             rows: [{ id, number, offsetIndex: int|null,
                      provenance: "generated"|"edited"|"imported",
                      canonicalRowId: uuid|null,          // explicit link only
                      source: {format,fileName,featureIndex,name}|null,
                      parts: [{ id, points: [{lat,lng}] }] }] }] }
```
- Coordinates: WGS84 decimal degrees, `{lat, lng}` objects (not GeoJSON order).
- A row is ONE logical physical row; `parts` are disjoint pieces along it (gaps from
  tracks/clipping). Length = sum of parts; gaps never count; parts are never bridged.
- Points are positional (no per-point ids). `parts[].points` is the exact path —
  clients must render it as-is (no decorative splines).
- Counts: reference row included once; `leftCount`/`rightCount` are additional rows.
  Left/right is relative to the reference's start→end arrow. Ascending numbering
  starts at `startNumber` on the leftmost row; descending starts it on the rightmost.
- `canonicalRowId` is never inferred from a matching number.

## Geometry
Offsetting/clipping/lengths use a block-local equirectangular projection centred
on the boundary centroid (metres). Generation rejects non-finite, self-intersecting
(folding) and crossing rows; warns for squeezed or skipped rows.

## Identity
- Regeneration keeps row/part ids by `offsetIndex`.
- JSON backup (`vinetrack.contour_row_mapping_export`, v1): restoring into the same
  draft/block/vineyard keeps ids; importing as new or into another block/vineyard
  regenerates every draft/group/mask/row/part id and clears `canonicalRowId`.

## Future activation (later phase)
Applying a draft to real rows must preserve existing `paddocks.rows` ids via explicit
`canonicalRowId`, coordinated with iOS/Android and SQL row-identity guards.
