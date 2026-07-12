
# Incremental Refresh Imagery

Rebuild the Refresh Imagery action so it inspects what is already stored, only processes the missing or incomplete items, and reports exactly what it did. Nothing about the underlying provider calls, storage layout, colour ramps or hover behaviour changes.

Confirming a few decisions before I start coding:

1. **Scope of "required layers"** — the spec lists all 11 indices (TRUE_COLOUR + 10 numeric) as required for a scene to be "complete". Today the client only asks the edge function to process the currently selected layer (`requested_index_types: [layer]`). To honour the completeness definition, Refresh Imagery will need to ensure **all 11** layers exist on the target scene, not just the currently displayed one. Confirm this is what you want (as opposed to "only the selected layer must be complete"). I will assume **all 11 layers**, matching your section 1.
2. **Refresh Imagery vs. Repair Missing Assets vs. Backfill 12-Month History** — I will keep the existing 12-month backfill button (already wired to `satellite-backfill-analytical`) as **Backfill 12-Month History (admin)**, add a new **Repair Missing Assets** admin button that runs the same backfill but scoped to *stored scenes only*, and make **Refresh Imagery** target only the latest expected scene per paddock.
3. **No new edge function is required.** The existing `satellite-process-scene` is already idempotent per `(provider_scene_id, paddock_id, index_type, asset_type, processing_version)` and skips re-uploading assets that already exist (see `existingAssets` reuse in `supabase/functions/satellite-process-scene/index.ts`). All new logic lives in the portal.

## What changes

### Completeness model (client-side, admin-only for the diagnostics)

New helper module `src/lib/satelliteCompleteness.ts`:

- `REQUIRED_INDICES` — the 11 indices from `LAYERS`.
- `requiredOutputsFor(index)` — `TRUE_COLOUR` needs only a display asset; every numeric index needs display + analytical + summary.
- `PROCESSING_VERSION` constant mirrored from the edge (`"v2"` — verified in `supabase/functions/_shared/satellite-cdse.ts`).
- `inspectCompleteness({ paddocks, scenes, assets, summaries, processingVersion })` returning:
  ```ts
  {
    perPaddock: Array<{
      paddockId; paddockName;
      latestSceneId: string | null;
      latestAcquiredAt: string | null;
      state: "complete" | "missing_latest_scene" | "incomplete_scene" | "old_processing_version";
      missingLayers: SatelliteIndexType[];               // no assets at all
      missingDisplayLayers: SatelliteIndexType[];
      missingAnalyticalLayers: SatelliteIndexType[];
      missingSummaries: SatelliteIndexType[];
      onOldProcessingVersion: boolean;
    }>;
    totals: {
      completePaddocks, missingPaddocks, incompleteScenes,
      missingDisplay, missingAnalytical, missingSummaries,
      oldVersionScenes, totalMissing,
    };
  }
  ```

"Latest scene" for a paddock = newest `satellite_scenes` row with `processing_status = 'complete'` (or `'processing'`/`'failed'` treated as incomplete). A paddock with **no** completed scene within the last `STALE_DAYS` (existing 3-day window) is `missing_latest_scene`.

### Refresh Imagery mutation rewrite

Rewrite `checkForNewImage` in `src/pages/tools/SatelliteMappingPage.tsx` so it:

1. Runs `inspectCompleteness` against the already-fetched scenes/assets/summaries (no extra network).
2. Shows a preflight toast:
   - `All current satellite imagery is already up to date.` → return, no processing.
   - Otherwise the summary from spec §6 (complete, missing paddocks, incomplete scenes, missing display / analytical / summaries).
3. For each paddock needing work:
   - `missing_latest_scene` → existing search + process flow, but `requested_index_types` = **all 11** required layers.
   - `incomplete_scene` (or `old_processing_version` with missing outputs) → **skip the CDSE Catalog search**. Reuse the stored `provider_scene_id`/`acquired_at`/`scene_cloud_cover_pct` from the latest scene row and call `satellite-process-scene` directly with `requested_index_types` = only the union of `missingLayers ∪ missingDisplayLayers ∪ missingAnalyticalLayers ∪ missingSummaries`. The edge function already reuses existing display/analytical assets on upsert, so this is naturally idempotent.
4. Progress messages match spec §7 wording.
5. Final toast reflects `X missing paddocks processed / Y complete paddocks skipped` or `No updates required`.
6. A short in-memory lock (`refreshInFlightRef`) prevents overlapping refreshes; the existing `AUTO_RUN_COOLDOWN_MS` is reused for the "no duplicate work across rapid clicks" requirement.

Button label is already `Refresh Imagery`.

### Repair Missing Assets (admin)

Rename the existing admin "Backfill layers for stored scenes" button to **Repair Missing Assets** and keep it wired to `satellite-backfill-analytical` (which already targets stored scenes and skips complete outputs — no server change needed).

Add a second admin button **Backfill 12-Month History** that calls `satellite-search-scenes` + `satellite-process-scene` across the full window per paddock. Marked "admin only, expensive".

### Diagnostics panel (system admin only)

New collapsible under the existing admin block:

```
Imagery completeness
  Total active paddocks:          8
  Paddocks with latest imagery:   7
  Paddocks missing latest:        1
  Complete scene packages:        7
  Partial scene packages:         0
  Missing display assets:         0
  Missing analytical assets:      0
  Missing summaries:              0
  Scenes on old processing ver.:  0
  Last refresh — processed:       1
  Last refresh — skipped:         7

  > Show missing item detail
      Cab Franc  — Missing latest scene
      Shiraz     — Complete
      Pinot Noir — Missing PSRI analytical; Missing GCI summary
```

Backed by the same `inspectCompleteness` output plus a `lastRefreshSummary` state populated by the mutation.

### All-Paddocks "Latest available per paddock" mode

Where the map currently renders overlays keyed off `newestByPad`, add a subtle `Imagery missing` chip for paddocks whose completeness state is `missing_latest_scene`. Refresh Imagery already targets those via step 3 above. No overlay reprocessing for complete paddocks.

## Files touched

- **new** `src/lib/satelliteCompleteness.ts` — pure completeness inspector + types.
- **new** `src/lib/satelliteCompleteness.test.ts` — unit tests for all-complete, missing paddock, missing analytical, missing summary, mixed, old version.
- **edit** `src/pages/tools/SatelliteMappingPage.tsx`
  - swap `computeStalePaddockIds` usage to the new inspector,
  - rewrite `checkForNewImage.mutationFn` per §Refresh above,
  - new preflight/final toast wording,
  - new diagnostics panel + missing-item collapsible,
  - rename admin backfill button; add optional 12-month admin button,
  - `Imagery missing` chip on the all-paddocks legend/list.
- **no edge-function changes** — `satellite-process-scene`, `satellite-search-scenes`, `satellite-backfill-analytical` are already idempotent and reuse existing assets.

## Validation

- `tsgo --noEmit` on the portal.
- New vitest cases: all-complete → no work; one paddock missing → one search+process; one scene missing PSRI analytical → one process call with `requested_index_types: ["PSRI"]` and no search call; old processing version with valid assets → only missing-version layers targeted; repeated click while pending → second click is a no-op.
- Manual smoke on `/tools/satellite-mapping` for a vineyard with mixed state: verify preflight numbers, verify only the incomplete paddock shows a spinner during refresh, verify the final toast lists processed vs skipped, verify the admin diagnostics panel matches.

## Out of scope

- Any change to hover sampling, colour scales, storage buckets, or existing edge-function behaviour.
- Any schema change (existing tables already carry `processing_version`, `asset_type`, summaries).
- Non-admin surfacing of the diagnostics panel — remains admin-only per the current page pattern.
