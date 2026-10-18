# Contour Row Mapping (Beta) — completion audit (inspection only)

Nothing was changed. Points marked UNVERIFIED were not confirmed by reading the code or running anything this turn.

## 1. What the draft editor does today

Confirmed by reading:
- **Storage**: a private schema `vt_contour_private` (drafts, saves, discarded_drafts), reached only through three public wrappers: get, save and discard (docs/contour-row-mapping-contract.md "Storage"; sql/contour_row_mapping_round1_applied.sql). Access requires System Admin plus vineyard membership. The Portal entry is a System Admin-only link (PaddockDetailPage.tsx:441, 993-1000) and the route at App.tsx:197.
- **Stale saves**: an expected draft id and revision are sent with each save. `stale_revision` and `stale_draft_discarded` are mapped to "your edits are kept" messages (draftApi.ts:25-26). Each save is read back, and a later revision counts as a conflict, never as our save (draftApi.ts:87-111). Network retries reuse the same save id.
- **Cross-vineyard**: payload `vineyardId`/`paddockId` must match the page scope (draft.ts:243). Loads are shape- and scope-validated before rendering (draftApi.ts:52-58). Working copies are keyed by user, vineyard and block, and cleared when the account changes (workingCopy.ts:15, 39-41; tested in contourRowMappingWorkingCopy.test.tsx).
- **Geometry checks** (checks.ts:16-110): self-crossing, parts of a row touching, rows crossing or overlapping, repeated points, zero-length parts, points outside the boundary / working area / cut-outs, a 10 m grid, and a 3M pair-test cap. Multipart parts are tested separately and never flattened (checks.ts:43, 99-100).
- **Rounded paths**: Chaikin smoothing has 0–2 iterations (geometry.ts:143). Offsets tighter than the curve radius are flagged (geometry.ts:176-183).
- **Imports**: GeoJSON and KML multi-geometries stay one row with several parts (importLines.ts:74-77, 105-110). Imported groups skip the working-area and cut-out checks (checks.ts:56) but still run the boundary check.
- **Ids and backup**: "restore" keeps ids only when the draft, block and vineyard all match. "Copy" regenerates ids and clears `canonicalRowId` (draft.ts:355, 365-390). Links to rows no longer in the block are flagged and can be cleared (ContourRowMappingPage.tsx:192, 593).

Hazards and gaps found (bugs found by reading only; none reproduced):
- H1 Coverage gap: checks run against the block outline loaded when the page opened. If someone edits the boundary in another tab, the saved draft can quietly fall outside the new outline. Nothing re-checks it until the draft is opened again. This is a review gap, not data loss.
- H2 `canonicalRowIds` is built once from the loaded paddock (ContourRowMappingPage.tsx:71). If someone regenerates rows in another tab, the links go stale until reload. The contract handles this by flagging, so it is low risk.
- H3 Imported groups skip the cut-out checks (checks.ts:56). This is intended, but it is not explained in the editor. UNVERIFIED whether the editor tells the user.
- H4 Draft row numbers are unique within the draft, but the draft is not checked against the operational row numbers in the block. Not a bug today, because nothing is activated. It would become a blocker at activation.
- UNVERIFIED: whether the server-side size limits (1.5x for jsonb) and the 4 MB client limit agree for the largest real drafts. Also whether the "too complex" cap is reached on real 2000-row imports. And browser trace interaction, which the contract itself says still needs a signed-in preview.

## 2. Block creation and ordinary edits vs the straight-row generator

- **Rowless contour-first creation does not exist.** NewPaddockPage refuses to save when no straight rows are generated (NewPaddockPage.tsx validation, "No rows generated"). It always writes `rows: generated` (line 245). The contour checkbox only opens the mapper after the block is saved, and the screen says operational rows are saved as set up in Rows (lines 450-466, 664-676). So every contour block also gets straight operational rows.
- **Edits overwrite rows with straight rows.** On PaddockDetailPage, both Save Boundary and Save Rows write `rowsToSave`. That is straight `generateRows` geometry merged onto the stored rows, keeping row identity (lines 268-301, 336-365). The draft is never read or written, so the draft cannot be overwritten. But any later contour activation would be overwritten by the next ordinary boundary or row save. That is the main hazard to design for.
- `paddockRowGeneration.ts` is untouched, as the contract requires.

## 3. Missing pieces for operational contour rows (none exist today)

1. **Persistence schema (owned by Rork)**: add an optional per-row geometry to `paddocks.rows`, for example `path: { parts: [[{lat,lng}]] }`, plus a block-level `row_geometry_mode` ('straight' | 'contour') and an `activated_from_draft_id`/revision. Keep `startPoint`/`endPoint` on every row (the first and last point of the path) so older apps keep working.
2. **Effective geometry read**: one shared helper (Portal, iOS, Android and SQL): `path` if present, else the straight start/end. Length = sum of the part lengths.
3. **Guards**: sql/253 (physical row number guard) and the row identity guards must accept `path`, keep ids by `canonicalRowId`, and reject geometry changes across vineyards. They also need an activation RPC: an atomic, revision-checked copy from the draft into rows, with the old rows snapshotted.
4. **Historic snapshots**: trips, pins, spray, pruning and yield must keep the row ids and numbers they recorded. Activation must never delete or renumber linked rows without an explicit mapping; unmapped old rows are retired, not deleted.
5. **Vine counts and length overrides**: the precedence must not change (block override, then complete per-row effective total, then fallback; `authoritativeVineCount`). Only the source of the row length changes, and the SQL 263 maths must use the same length formula.
6. **App safety**: older mobile builds must render the start/end fallback and must not strip `path` when they save. This needs a minimum app version, or a block lock where blocks in contour mode can't be edited from the straight-row editors.
7. **Who can do it**: activation by owner/manager after the System Admin pilot. Server-enforced.
8. **Rollout and revert**: an activation feature flag owned by the shared backend. Revert means restoring the snapshot taken at activation, or switching back to straight mode and dropping `path` with the same ids.
9. **Portal editors**: PaddockDetailPage and NewPaddockPage must refuse straight regeneration on contour-mode blocks, or ask for explicit confirmation.

## 4. Smallest safe Portal-only fixes (no activation, no database changes)

- F1 Re-run `checkDraftGeometry` when the editor regains focus or is reloaded, and show a "block boundary changed since the draft was saved" notice (H1). Optionally refresh `canonicalRowIds` at the same time (H2).
- F2 Show which checks are skipped for imported groups (H3).
- F3 Show an advisory warning (it does not block saving) when draft row numbers differ from the block's operational numbers (H4).
- F4 On PaddockDetailPage, when the block has a saved contour draft, note next to Save Boundary/Rows that straight rows will be regenerated and the draft is unaffected (System Admin only).
- Tests to run: src/test/contourRowMapping.test.ts, contourRowMappingEditor, contourRowMappingWorkingCopy, contourEditorRowActions, contourRowNumbering, contourSideShiftZoom, contourRowMappingAccess, newPaddockContourHandoff, rowStartNumber, fullBlockBackupIdentity, summaryVineCount, rowVineCountCalculation. Add a test for each fix.

## 5. Phases and acceptance

**Phase A — Draft mapping complete (Portal only)**: F1–F4 shipped, all tests listed above pass, and a signed-in browser run covers trace, import (multipart KML), save, conflict from a second tab, discard and restore.
Accept when:
- the draft can never reach save while it has geometry errors;
- a stale or second-tab save never replaces newer data;
- operational `paddocks.rows` is byte-identical before and after every draft action (checked with a hash).

**Phase B — Shared contract (Rork)**: the schema fields from 3.1, the effective-geometry helper ported to SQL, iOS and Android, guard updates to sql/253, and a minimum app version.
Accept when:
- old apps round-trip `path` unchanged;
- SQL 263 totals equal the Portal totals for the same rows.

**Phase C — Activation RPC and snapshot**: an atomic activation from draft id + revision, keeping ids through `canonicalRowId`, with a snapshot table and a revert RPC.
Accept when:
- every historic trip, pin, spray, pruning and yield row reference still resolves;
- revert restores the stored rows byte-for-byte.

**Phase D — Portal activation UI**: owner/manager action behind the flag; straight editors locked in contour mode.
Accept when straight regeneration can't silently replace contour rows.

**Operational contours complete** means Phases B–D are done and signed off on iOS and Android. Today only Phase A's foundations exist.

## Technical notes
Key files: src/pages/setup/ContourRowMappingPage.tsx, NewPaddockPage.tsx, PaddockDetailPage.tsx, src/lib/contourRows/*, src/lib/paddockRowGeneration.ts (do not change), sql/contour_row_mapping_round1_*.sql, sql/253_paddock_physical_row_number_guard.sql, src/lib/paddockRowVines.ts, docs/contour-row-mapping-contract.md.
