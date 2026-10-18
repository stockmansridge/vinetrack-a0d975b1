# Contour Rows — contour-first block setup + F1 freshness correction (design only)

Nothing is changed in this turn. Confirmed facts below come from reading the code this turn. Anything else is marked as an assumption or a blocker.

## Confirmed starting point
- New Block (src/pages/setup/NewPaddockPage.tsx) runs through these steps: details, boundary, rows, varieties, trellis, review.
  - The rows step can't move on until straight rows are generated (line 432).
  - Saving always writes the generated straight rows as the block's rows (line 245).
- The contour editor (src/pages/setup/ContourRowMappingPage.tsx) needs a block that already exists. Its drafts are stored only in the private draft storage.
- On an existing block (src/pages/setup/PaddockDetailPage.tsx), Save Boundary and Save Rows both regenerate straight rows (lines 336–365).
- The database row-number guard (sql/253) skips empty or missing row lists (line 32), so the database alone would not stop a block with no rows. About 78 Portal files read rows, and the iOS/Android behaviour with an empty row list is unknown. So an empty row list is **not approved** as a contour placeholder.
- F1 gap: `blockSnapshot` (src/lib/contourRows/blockFreshness.ts) compares the boundary plus only the sorted row ids. A normal straight regeneration keeps the ids but can change row numbers and row ends, and that goes undetected.

## A. F1 correction (Portal only, can be done now)
- Replace `rowIdsKey` with a canonical row key. Each row becomes the tuple `[id, number, startLat, startLng, endLat, endLng]`, built from `parseRows` with fixed field order (so the order properties appear in the stored data doesn't matter). Coordinates are rounded to 1e-9. Rows are sorted by id, then number.
- Report the result as `{ boundaryChanged, rowIdentityChanged, rowNumbersChanged, rowGeometryChanged }`. The warning names each kind of change.
- The boundary key uses the same fixed-order rounding.
- Also check the block's id and vineyard each time (this already happens in `fetchCurrentBlock`). Keep the "can't lock during save" wording.
- Tests (src/test/contourBlockFreshness.test.tsx):
  - same ids with changed coordinates → flagged as a geometry change;
  - same ids with a changed number → flagged as a numbering change;
  - data with properties in a different order → unchanged;
  - nothing changed → unchanged;
  - boundary changed → flagged;
  - added or removed id → identity change;
  - edits survive every case.
- New block page tests (src/test/paddockDetailStraightSaves.test.tsx). These mock the save and assert:
  - Save Boundary still sends `polygon_points` plus the regenerated `rows`, keeping stored row ids by number and stored extra fields;
  - Save Rows sends the same set of fields as today;
  - the contour notice never changes either payload;
  - neither save ever calls a contour-draft function.

## B. Contour-first experience

### Screen 1 — the new first question in New Block (before Details)
```text
Does this block use straight rows or contour rows?
( • ) Straight rows   — Rows run in straight lines across the block. (Default)
(   ) Contour rows    — Rows follow the land. You'll trace, generate or import
                        curved rows in the Contour Row Mapping editor.
        Beta · System Admin only
```
- Only **System Admins** see the Contour option. Everyone else gets today's flow with no question shown, so nothing changes for them.
- The choice is kept as the user moves between steps. It's held in the page's state, keyed by vineyard and attempt, the same way the existing contour checkbox already works (lines 107–115). It's reset when the vineyard changes.
- Choosing Straight keeps today's steps exactly as they are, byte-for-byte the same save.

### Screen 2 — Contour path, Phase 1 (no storage approved yet)
- Steps: Details, Boundary, then a **Row layout** step that says:
  > "Contour-first blocks can't be saved yet. VineTrack's phones and reports still need straight rows for every active block. You can either:
  > 1. Set up temporary straight rows now and map contours afterwards (contour draft stays separate), or
  > 2. Go back and choose Straight rows."
- Option 1 is the existing handoff, relabelled honestly: "Save with straight rows, then open contour mapping". The existing confirmation stays.
- "Finish as contour block (no straight rows)" is shown **disabled**, with the label "Needs a VineTrack update — coming later". There are no placeholder rows and no empty-rows save.

### Screen 3 — Contour path, Phase 2 (after Rork approves staging)
- The block is saved in a **pending configuration** state. It has its boundary and details but no operational rows, and is marked pending row layout.
- The full-screen contour editor then opens on it. The banner reads: "Pending block — not active. Rows here are a draft until activated."
- The block is hidden from spray, pruning, yield, trips and mobile lists until it's activated.

### Existing blocks — Rows tab in Block Setup
Adds a status card:
```text
Operational row layout: Straight (active)        ← from block data only
Contour draft: Saved · revision 4  |  None        ← System Admin only
[Open contour mapping (Beta)]
```
- The operational layout comes **only** from the block's own operational data. Today that is always "Straight". Later it will come from the operational geometry mode Rork adds. A saved contour draft never changes this label.
- The F4 notice stays next to Save Boundary and Save Rows.

### Contour editor header
- Two status chips: "Draft mapping — not active" and "Operational rows: Straight (N rows)".
- After Phase 2 the operational chip can read "Pending block — no active rows".

## C. Data and lifecycle requirements (Rork-owned; blockers for Phase 2+)
1. `paddocks.configuration_status` with values 'active' (default) or 'pending_rows'. Pending blocks are excluded server-side, through security rules or a view, from every operational read and every mobile sync. Alternatively, a separate private staging table that is promoted on activation. Rork chooses one.
2. The sql/253 guard plus a new rule: rows may be empty only while the block is `pending_rows`. Active blocks need at least one valid row.
3. Every Portal consumer of rows needs a pending-block check. The file inventory comes first; at least 78 files read rows.
4. Older iOS/Android builds must never receive pending blocks.
5. Who can act:
   - creating a pending block: System Admin during the pilot, later owner/manager;
   - discarding it: the same roles;
   - pending blocks older than N days get flagged in the System Admin area.
6. Activation (a later stage) writes operational geometry and turns the block 'active'. It follows the earlier Phases B–D: keep `startPoint`/`endPoint`, an optional `path`, a snapshot taken before activation, a revert option, and the same vine-count priority order as today.

## D. Phases
- **P0 (Portal, now):** F1 canonical comparison, plus the block page save tests.
- **P1 (Portal, now, no operational writes):**
  - the first question, admin-only Contour option;
  - choice kept between steps;
  - honest contour path with the finish disabled;
  - the "Save with straight rows, then map" handoff;
  - the Rows-tab operational layout card and draft status;
  - editor status chips.
- **P2 (Rork):** the pending-configuration schema, guard changes, operational exclusion, mobile filtering. The Portal then enables "Save as pending contour block" and the contour editor on pending blocks.
- **P3 (Rork + Portal):** contour activation, as in the earlier audit Phases B–D.

## E. Files
- P0:
  - src/lib/contourRows/blockFreshness.ts
  - src/pages/setup/ContourRowMappingPage.tsx (warning text)
  - src/test/contourBlockFreshness.test.tsx
  - new src/test/paddockDetailStraightSaves.test.tsx
- P1:
  - src/pages/setup/NewPaddockPage.tsx (new "layout" step plus contour branch)
  - src/pages/setup/PaddockDetailPage.tsx (Rows status card)
  - src/pages/setup/ContourRowMappingPage.tsx (chips)
  - new src/lib/rowLayoutMode.ts: `operationalLayoutFor(paddock)`, which returns "straight" today and never reads drafts
  - tests: newPaddockContourHandoff.test.tsx (extended), new rowLayoutMode.test.ts, new newPaddockLayoutChoice.test.tsx
  - docs/contour-row-mapping-contract.md (new "Contour-first" section)
- P2/P3: Rork migrations plus a Portal reads inventory (to be listed in P2).

## F. Acceptance criteria
- Straight path: the New Block insert is deep-equal to today's for the same inputs (snapshot of the save fields in a test). Non-admins never see the question.
- The choice survives Back/Next between all steps, and is cleared when the vineyard changes.
- The contour path can't save a block without straight rows in P1. No empty row list and no placeholder rows are ever sent (asserted on the mocked insert).
- The Rows-tab layout label is "Straight" even when a contour draft exists (test).
- F1: every case in section A is caught, and edits are kept.
- Save Boundary and Save Rows keep their exact current saves.
- All contour, row, working-copy and block-setup checks pass.
- Signed-in browser check of both paths. Report it as unverified if it can't be done.

## Blockers and assumptions
- **Blocker for a true contour-first save:** the pending-configuration lifecycle needs Rork's schema, guard and mobile filtering.
- **Assumption:** pilot gating stays System Admin.
- **Unverified:** how iOS/Android handle a block with no rows, and whether any existing blocks already have empty rows.

## Separate open item — Fertiliser "Target Nutrient" audit (paused)
- The Portal implements only per-hectare and per-vine (src/lib/fertiliserCalc.ts:15). `nutrientTarget` is only named in a comment.
- Products only store N/P/K percentages plus analysis basis and density (FertiliserCalculatorDialog.tsx:152). There is nowhere to store Ca, Mg, S, micronutrients, or a per-record nutrient snapshot.
- **Existing safety bug:** saved records that aren't per-vine are shown and reopened as per-hectare (FertiliserCalculatorPage.tsx:312, 323; FertiliserCalculatorDialog.tsx:246, 249). A `nutrientTarget` record made on a phone would be shown and reopened as per-hectare.
- This needs its own plan and a Rork contract; I'll take it up after this plan.
