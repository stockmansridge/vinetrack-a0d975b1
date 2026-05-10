# Damage Records — Spatial Mapping (Phase Plan)

## Phase 1 — shipped

- Damage records read `damage_records.polygon_points` and `damage_records.damage_percent` from the iOS-owned Supabase project.
- `polygon_points` is parsed with the existing `parsePolygonPoints` helper, which already handles the iOS canonical `{latitude, longitude}` shape, the `{lat, lng}` shape, and `[lat, lng]` tuples (`src/lib/paddockGeometry.ts`).
- The Damage Records detail drawer renders the paddock polygon (green, low opacity) and the damage polygon (red, higher opacity) on Apple Maps via the shared `DamageMapView` component (`src/components/DamageMapView.tsx`).
- The same view appears in the create/edit drawer once a paddock is selected, showing existing damage polygons synced from iOS.
- `src/lib/damageImpact.ts` calculates:
  - `damagedAreaHa` — `polygonAreaHectares(damage.polygon_points)`, falling back to the whole block area when no polygon is present (matches iOS row/area-only records).
  - `effectiveAreaHa` — `damagedAreaHa × damage_percent / 100`.
  - `blockLossPct` — `effectiveAreaHa ÷ blockAreaHa × 100`.
- These numbers are surfaced in the detail drawer's "Damage area" section (block area, damaged area, intensity, effective loss, block yield impact %) and a lighter version is shown live in the edit drawer.
- `aggregateDamageByPaddock(records, blockAreaByPaddockId)` is exported for Yield Estimation to consume in Phase 3 (caps each paddock at 100% loss).

### iOS-compatible polygon format (confirmed)

`polygon_points` is a `jsonb` array; each point uses iOS's canonical
`{ "latitude": <number>, "longitude": <number> }` shape, identical to
`paddocks.polygon_points`. The portal writes nothing to this field yet — Phase 2
will write back in the same shape so iOS continues to consume the records
unchanged.

## Phase 2 — portal polygon draw / edit (next)

Goal: let managers/owners draw or edit the damage polygon in the portal and
write back to `damage_records.polygon_points` in the iOS shape.

Implementation sketch:

1. New `DamagePolygonEditor` component built on Apple MapKit JS.
   - Render the selected paddock polygon (read-only, green outline).
   - Click/tap to add vertices, drag to move, double-click to close, "Clear" to reset.
   - Snap vertex insertion to the paddock polygon's bounding region; warn (do not block) if a vertex falls outside the paddock.
   - Internally use `LatLng[]` and serialise to `[{ latitude, longitude }, …]` on save.
2. When the drawer is too cramped (<sm breakpoint or polygon >10 vertices), open a full-screen "Map damage area" modal route (`/damage-records/:id/map`) that mounts the same editor at viewport size.
3. Save path: extend `updateDamageRecord` / `createDamageRecord` to accept `polygon_points: LatLng[]` and convert to the canonical iOS shape before insert/update.
4. Live recompute the damage area, effective loss and block yield impact as the user edits — already wired in `DamageEditMap`.
5. Keep `latitude` / `longitude` as an optional reference point (auto-fill from the polygon centroid if both are blank when the polygon is drawn).
6. Keep `row_number` / `side` as optional row metadata.

No schema change required — `polygon_points` and `damage_percent` already exist
and are RLS-writable for owners/managers per the policies Rork installed.

## Phase 3 — feed Yield Estimation

When the Yield Estimation page is built, it should:

1. Load active paddocks (`fetchList<paddock>("paddocks", vineyardId)`).
2. Load active damage records (`fetchDamageRecordsForVineyard(vineyardId)`).
3. Build `blockAreaByPaddockId` from `polygonAreaHectares(paddock.polygon_points)`.
4. Call `aggregateDamageByPaddock(records, blockAreaByPaddockId)` to get
   `{ totalEffectiveHa, blockAreaHa, lossPct, recordCount }` per paddock.
5. Apply `1 - lossPct/100` as a multiplier to the per-block yield estimate, and
   surface the contributing damage records on hover/click.
6. Optional: filter records by season/date window before aggregating
   (`date_observed` between season start and season end).

All of the calculation primitives needed for Phase 3 already live in
`src/lib/damageImpact.ts` — Yield Estimation should consume that module rather
than recomputing.
