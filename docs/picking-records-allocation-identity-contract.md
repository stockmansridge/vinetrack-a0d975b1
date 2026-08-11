
---

## Revision 2 — planting GROUPS supersede single-allocation identity (2026-08-11)

### Backend audit (live probe of the VineTrack data project, PostgREST schema)

`public.picking_records` columns currently deployed:

`id, vineyard_id, picked_at, vintage, paddock_id, paddock_name, variety_id,
variety_key, variety_name, clone, weight_kg, sugar_value, sugar_unit, ph,
ta_g_l, purpose, sold, sold_to, price_per_tonne, grape_value, notes,
created_at, updated_at, created_by, updated_by, deleted_at, sync_version,
client_updated_at`

NOT present (probe returns `42703 column ... does not exist`):
`variety_allocation_id`, `rootstock`, `clone_key`, `rootstock_key`,
`planting_group_id`, `planting_group_key`, `variety_allocation_ids`.

`public.picking_yield_totals` exposes only
`vineyard_id, vintage, paddock_id, paddock_name, variety_name, pick_count,
total_weight_kg, actual_yield_tonnes, first_picked_at, last_picked_at,
total_grape_value` — no clone/rootstock/allocation dimension.

**Conclusion:** the last deployed picking migration is sql/180. The proposed
allocation-identity migration has **not** been deployed. This is exactly why a
planting selection in the Portal editor does not survive save/reload — the
Portal writes the field, PostgREST rejects the unknown column, and the client
retries without it (`writeWithOptionalColumns`). The dropdown is not proof of
persistence.

### Required identity — planting group, not one allocation

A single `variety_allocations[].id` cannot represent a planting group that
spans multiple physical sections, and using one arbitrary member id would
mis-attribute all yield to that section. Required semantics:

- one picking record belongs to **one planting group**;
- a planting group contains **one or many** physical allocation ids;
- historical `variety_name` / `clone` / `rootstock` snapshots stay on the record;
- Block Setup keeps every physical allocation unchanged.

Requested server fields on `picking_records` (Rork to choose the storage shape):

| field | type | notes |
| --- | --- | --- |
| `planting_group_key` | `text` null | deterministic, block-scoped grouping key (below) |
| `clone_key` | `text` null | catalogue key snapshot (sql/182) |
| `rootstock_key` | `text` null | catalogue key snapshot |
| `rootstock` | `text` null | display snapshot |
| `variety_allocation_ids` | `uuid[]` null | member sections at time of recording (audit only) |

`picking_yield_totals` must add `planting_group_key`, `clone`, `rootstock` (and
the key columns) to its grouping so totals reconcile per planting group.

### Grouping algorithm (canonical, must be identical on iOS / Android / Portal)

```
group_key = lower(trim(variety))            + "|" +
            lower(trim(clone_key    ?? clone))    + "|" +
            lower(trim(rootstock_key ?? rootstock))
```
scoped to the block (`paddock_id`). Group hectares = sum of member allocation
hectares; group percent = sum of member percents. Same variety + clone +
rootstock → one group; any difference in variety, clone identity or rootstock
identity → separate groups.

### Payloads

Create/update (portal, once deployed):

```json
{
  "paddock_id": "...", "variety_name": "Pinot Noir",
  "clone": "777", "clone_key": "777",
  "rootstock": "Richter 110", "rootstock_key": "richter_110",
  "planting_group_key": "pinot noir|777|richter_110",
  "variety_allocation_ids": ["a1", "a3"]
}
```

Legacy behaviour: records without a group key resolve by variety + clone (+
rootstock) snapshot; anything still ambiguous displays **"Planting not linked"**
and is never guessed or duplicated.

### Portal status

The Portal now groups plantings client-side (`buildPlantingGroups` in
`src/lib/yieldAllocations.ts`) for Picking selection and Yield Overview, and it
does **not** invent a backend identity: a group spanning more than one physical
section writes no allocation id at all until the shared contract above ships.
