# Soil Analysis multi-block Trends

## Requested result
- Select one or more name-sorted blocks with shared chips, All blocks and Clear controls.
- Plot one compatible analyte series with separate raw samples and date-average lines for each block; never average across blocks.
- Show per-block latest values, changes, laboratory status and sample/date counts, retaining selected blocks without data.
- Add Block to the oldest-first raw table and update only the Trends help step.

## Technical details
- Add `listBlocksAnalyteResults` using the existing mapping resolver and server-side analyte filter, preserving the current sample visibility semantics.
- Reuse Compare's selection pattern in a small shared control without changing its reporting behaviour.
- Keep existing strict/provisional visual-series rules; partition an active series by matched block before averaging or summarising.
- Test mapped-result deduplication, analyte filtering, selection, compatibility and block-isolated averages, plus existing release/navigation regressions.
- No SQL, schema, functions, ingestion, mobile or publication changes.

## 1. Tabs
- `src/pages/setup/YieldReportsPage.tsx` ~L745–768: Overview, Yield Estimate Trips (`sessions`), Actual Yields (`historical`), Picking Log, Grape Allocation. Content blocks are at ~L819–880.
- Deep-link allow-list: `src/lib/yieldTab.ts` (`YIELD_TABS`). The test `src/test/yieldAllocationDeepLink.test.ts` loops over every tab.
- New tab: `value="bunch-weights"`, placed right after the `sessions` trigger. Add it to `YIELD_TABS` and build a new `src/components/yield/BunchWeightsPanel.tsx`.

## 2. Overview precedence (diagnosis not yet confirmed)
- Rule: `src/lib/bunchCountTrips.ts` `currentEstimatesByBlock(trips, vintage)` takes the latest **completed** trip that has recorded samples in that block (sorted by completedAt, then createdAt). Results are never summed. Called at YieldReportsPage ~L388.
- Merge: the `seasonEstimates` memo (~L544–600) puts trip tonnes into `bunchByBlock`. If a block has none, it uses `block.tonnes` (SQL 221 pruning base, with damage applied).
- Paths that can still show pruning even though a completed trip exists. None of these is confirmed against live data yet:
  a. `est.tonnes == null` is skipped (L557). If vines or area are missing, the trip yields no tonnes and the code silently falls back to pruning.
  b. Vintage = "All vintages" passes `null` into `currentEstimatesByBlock`.
  c. Trip vintage comes from `vintageOf(sortDate)` (the season-start window). A trip completed just before or after the season boundary can land in a different vintage.
  d. Block keys are lowercased on one side; check the `paddockId` casing coming from the payload.
  e. Trip tonnes are split per variety only for blocks inside `seasonModel.blocks`. A block with no SQL 221 groups gets no per-variety value.
- Provenance: `seasonModel.blocks[].estimateSource` and `sourceInputs` come from `src/lib/seasonYieldContract.ts` L115/253. The popover is `src/components/yield/BlockEstimateInfo.tsx`. When a trip supersedes, it only gets a boolean `supersededByBunchCount` (YieldReportsPage ~L1124). The popover still lists the pruning inputs. `buildYieldOverview` (`src/lib/yieldOverview.ts`) has no estimate-source field.

## 3. Bunch weight sourcing
- Trips: `src/lib/yieldSessionSummary.ts` L134–245. Order is payload `blockBunchWeightsKg[blockId]`, then the flat `averageBunchWeightKg`, then `DEFAULT_BUNCH_WEIGHT_KG` (0.15 kg = 150 g, from `src/lib/pruningYieldFormula.ts`). It sets `bunchWeightIsDefault`. The drawer shows "(default)" (L1463) and the notice "default 0.15 kg" (L1544).
- Overview pruning base: `source_inputs.bunch_weight_grams` is computed by the server (SQL 221). The Portal never applies a fallback for it. A missing value raises the `missing_bunch_weight` warning.

## 4. Trips table and drawer
- Table/cards: `src/components/yield/BunchCountTripsPanel.tsx`. Sampling settings: `BunchCountSamplingCard.tsx`.
- Drawer: in YieldReportsPage ~L1309. It is `SheetContent className="w-full sm:max-w-xl"` (about 576 px). It has a per-site table with `fmtCoord(s.lat, s.lon)` (L1509).
- GPS is already in the payload: `sampleSites[].latitude/longitude`, parsed to `lat`/`lon` in `yieldSessionSummary.ts` L32.
- Reusable maps: `src/components/scout/ScoutStopsMap.tsx` (point stops, the closest fit), `PaddockMapView.tsx` / `PaddockMap.tsx` (block polygons), `SelectedPinMap.tsx`.

## 5. Grape Allocation bottom table
- `src/components/yield/GrapeAllocationPanel.tsx` ~L390–400. Columns: Type, Variety, Destination, Contact, Tonnes, Price/t.
- Block data is already loaded as `grape_allocation_blocks(paddock_id, quantity_tonnes)` (`src/lib/grapeAllocationsQuery.ts` L72/100). Add a Block column after Variety. Map names from the `blocks` prop. Several blocks are joined with commas; none shows "All blocks / —".

## 6. Tests and contracts to update
- `src/test/yieldAllocationDeepLink.test.ts`, `yieldPageUi.test.tsx`, `bunchCountTripHistory.test.tsx`, `yieldPrivacyAndTrips.test.ts`, `yieldParity.test.ts`, `seasonYieldEstimates.test.ts`, `yieldOverview.test.ts`, `grapeAllocations.test.ts` / `grapeAllocationBlocks.test.ts`.
- Types: `SessionBlockSummary` (bunch-weight source), `YieldOverviewCard` (estimate source), `SeasonYieldBlockEstimate`.
- Docs: `docs/pruning-yield-settings-contract.md`, memory `seasonal-yield-estimate-contract`.

## 7. Minimal backend contract needed (owner/ChatGPT to build; Lovable will not write SQL)
- Table `vineyard_bunch_weights`: id, vineyard_id, scope (`block`|`variety`), paddock_id (null for variety scope), variety_key (canonical variety identity), vintage (nullable means all vintages), bunch_weight_grams > 0, updated_by, updated_at, deleted_at. Unique on (vineyard_id, scope, paddock_id, variety_key, vintage) among active rows.
- RLS: members can read; owner/manager can write. Read-only trial rule applies.
- RPCs:
  - `get_vineyard_bunch_weights(p_vineyard_id, p_vintage)`
  - `upsert_vineyard_bunch_weight(...)`
  - `delete_vineyard_bunch_weight(id)` (soft delete)
  - `resolve_bunch_weight(p_vineyard_id, p_paddock_id, p_variety_key, p_vintage)` returns `{grams, source: 'block'|'variety'|'default', record_id}`.
- Resolution order: block+variety+vintage → block+vintage → block (any vintage) → variety+vintage → variety → one documented default (150 g). The source is always returned.
- SQL 221 base estimate and mobile trips should consume the same resolver so iOS, Android and the Portal agree. Rork owns mobile adoption.

## Implementation steps (after approval and once the backend contract is live)
1. Add the Bunch Weights tab and panel (block and variety lists, editing for owner/manager only, source badges).
2. Overview precedence: confirm causes a–e against Stockman's Ridge data first. Then make a completed trip always lead. When the trip cannot produce tonnes, show "Trip incomplete" with a reason instead of silently falling back. Add `estimateSource` to the overview cards and popover.
3. Trip summary bunch weight: payload → resolver (block, then variety) → default, with a labelled source.
4. Drawer: widen to `sm:max-w-3xl` and add a sample-site map using the existing point map.
5. Add the Block column to the Grape Allocation table.
6. Update the tests listed above.

## Known risks
- Precedence changes alter displayed totals and the Grape Allocation availability numbers.
- Variety identity must match the canonical `variety_key` and planting groups. A mismatch would apply the wrong weights.
- Mobile and the SQL 221 estimate will disagree until they adopt the resolver.
- Historical trips must keep the bunch weight stored in their payload. Never re-resolve them retroactively.
- Allocations with no block rows must not be shown as belonging to a block.
