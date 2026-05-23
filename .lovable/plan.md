# Reorderable Table Columns

Add a reusable system for users to drag/reorder table columns across the portal, with per-user, per-table persistence.

## Scope

Phase 1 (this change): build the reusable system + apply to **Chemicals** table as the reference implementation.
Phase 2 (follow-up): roll out to remaining tables (pins, trips, spray reports, rainfall, dashboard, work tasks, team, blocks, documents).

I'll stop after Phase 1 and confirm the pattern looks right before rolling out everywhere — that avoids touching ~10 large pages in one go and shipping regressions in sort/filter/export/pagination.

## Storage

New Supabase table `user_table_preferences`:

- `user_id` (auth.users)
- `vineyard_id` (nullable — null = applies across vineyards)
- `table_id` (text, e.g. `chemicals_table`)
- `column_order` (jsonb array of stable column IDs)
- `hidden_columns` (jsonb, reserved for future show/hide)
- unique `(user_id, vineyard_id, table_id)`

RLS: users can only select/insert/update/delete their own rows.

## Reusable API

```
src/lib/userTablePreferencesQuery.ts
  - useColumnOrder(tableId, defaultColumnIds, { vineyardScoped? })
    returns { order, setOrder, reset, isLoading }
  - Local cache via React Query, debounced upsert to Supabase.
  - Falls back to localStorage when signed out / offline.

src/components/table/ReorderableTableHeader.tsx
  - Wraps <TableHeader>/<TableRow>.
  - HTML5 drag-and-drop on <TableHead> by stable column id.
  - Respects locked columns: `lockedStart` (e.g. select/expand) and
    `lockedEnd` (e.g. actions) — these can't be dragged and can't be
    dropped into the middle.
  - Small grip icon (GripVertical) appears on hover next to label.
  - Click on the existing sort button still sorts (drag starts only
    from the grip or the empty area, not the sort button — pointer-down
    on a `[data-no-drag]` element cancels the drag).

src/components/table/ColumnSettingsMenu.tsx
  - DropdownMenu trigger button "Columns" placed near search/filters.
  - "Reset column order" item.
  - Stub for future show/hide.
```

Column definition shape:

```ts
interface ColumnDef { id: string; label: string; locked?: "start" | "end" }
```

## Apply to Chemicals page (reference)

`src/pages/setup/SavedChemicalsPage.tsx`:

- Define `CHEMICALS_COLUMNS: ColumnDef[]` with stable IDs:
  `product`, `manufacturer`, `group`, `use`, `active_ingredient`,
  `rate`, `whp`, `rei`, `label`, `updated`, `actions` (locked end).
- Call `useColumnOrder("chemicals_table", defaultIds)`.
- Render header cells and body cells in the resolved order; `actions` stays pinned right.
- All existing sort/filter/search/edit logic untouched.

## Acceptance

- Drag columns left/right on chemicals page; refresh — order persists.
- Actions stays far right; locked columns can't be moved.
- Sort arrows + filter dropdowns still work.
- Reset menu restores defaults.
- Per-user (RLS) and per-table (table_id) isolation.

## Out of scope for this change

Other tables — once the chemicals implementation is signed off, the same `useColumnOrder` + `ReorderableTableHeader` are dropped into each remaining page (mostly a column-definition + render-loop refactor per page).
