# Complete vineyard-wide Pin Colour parity

## Goal
Make the current selected vineyard’s launcher-button configuration authoritative for every Portal pin colour, while retaining safe compatibility for older pins and the existing mobile/database contracts.

## Implementation

### 1. Extend the shared configuration index
- Refactor the existing pin colour configuration model into explicit vineyard-local lookups:
  - stable launcher button ID
  - canonical Repair category
  - normalized legacy button name
- Keep parsing `vineyard_button_configs` only, with the exact shared mobile palette and existing compatibility aliases.
- Avoid fuzzy matching and avoid merging data between vineyards.

### 2. Make one display resolver authoritative
- Extend `pinDisplayStyle` and its configuration lookup to use this precedence:
  1. current configuration by `launcher_button_id`
  2. current configuration by canonical Repair category
  3. current configuration by normalized legacy button name
  4. valid historical `button_color`
  5. canonical category/mode fallback
  6. neutral grey
- Ensure a stable ID survives button renames and that current configured colours override historical snapshots and fixed Repair defaults.
- Remove duplicated colour-token parsing from the legacy helper by reusing the shared colour parser.

### 3. Read and write stable launcher identity
- Add nullable `launcher_button_id` to the Portal pin model.
- Keep pin reads backwards compatible; existing `select("*")` queries will receive the field after SQL 241 is live.
- Preserve the exact configured launcher identity through the Add Pin catalogue and write it on new Repair/Growth pins, while leaving legacy NULL rows valid.
- Do not add or apply SQL.

### 4. Align all Portal pin presentation
- Keep Apple Maps, fallback maps, block/overview maps, pin tables, detail panels/sheets, selected-location maps, completed pins, and existing previews on `pinDisplayStyle`.
- Replace direct category colour lookup in the Pins legend with the common resolver.
- Preserve the overview’s explicit age-colour viewing mode; its normal/default pin mode will use the authoritative resolver.
- Do not change placement, filtering, completion, trip, photo, Growth Stage, spray, or deletion behavior.

### 5. Refresh across vineyards and devices
- Keep the colour query key scoped by vineyard ID so switching vineyards cannot reuse another vineyard’s values.
- Refetch colour configuration whenever the window regains focus and on a bounded foreground interval, while vineyard changes naturally select a different cache entry.
- Centralize the query key so any Portal configuration mutation can invalidate both colour display and launcher catalogue data immediately; no new editor or realtime framework will be introduced where none exists.

## Validation
- Add focused resolver tests for stable identity, rename continuity, Repair/Growth overrides, normalized legacy names, canonical legacy matching, historical fallback, safe unknown fallback, exact mobile HEX tokens, and vineyard independence.
- Add focused query/cache tests proving vineyard-specific keys and refresh settings.
- Update creation tests to prove `launcher_button_id` is retained and written.
- Add renderer/source-contract coverage confirming major pin surfaces use the common resolver.
- Run only the focused pin tests, the touched-file lint check, and TypeScript validation.

## Constraints preserved
- SQL 241 is assumed to be applied before release; no migration will be created or executed.
- No user/device colour preferences, Master/mobile changes, or unrelated Pin behavior changes.
