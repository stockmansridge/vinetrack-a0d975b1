## Goal

Make the Satellite Mapping page self-healing: when a paddock has no imagery within the last 3 days, silently gather it — on page load and when the user asks. Merge the two action buttons into one that both fetches new imagery and generates cell readings, shows a progress bar, and automatically retries any skipped paddocks once.

## Behaviour

### Stale detection (3-day rule)
For each paddock in the active vineyard, look at the newest completed scene from `scenesQuery`. A paddock is "stale" if:
- No completed scene exists at all, OR
- Newest completed scene's `acquired_at` is older than 3 days from now, OR
- Newest completed scene lacks an analytical raster for the currently selected layer (cell readings missing).

### Auto-run on page load
When the vineyard's scene data first loads and any paddock is stale, automatically trigger the unified refresh for just those stale paddocks. Guard so it only fires once per vineyard per session (ref keyed by `vineyardId`).

### Unified action button
Replace "Process Latest Imagery" and "Generate Cell Readings" with a single button labelled "Refresh Imagery". When clicked:
1. Compute the stale-paddock set (or use all paddocks if user is on a single paddock and it's stale/forced).
2. Run the existing `processOne` worker pool against that set (produces display + summary + analytical inline via `satellite-process-scene`, which already writes analytical rasters for new scenes).
3. After the pool completes, call `satellite-backfill-analytical` scoped to the vineyard to fill any analytical rasters still missing on older completed scenes.
4. Recompute stale paddocks. If any remain stale AND haven't already been retried this run, re-run step 2 once for that residual set. Track a `retriedOnce` flag so we never loop more than twice.

If the user is viewing a specific paddock, the button only targets that paddock (still applies the 3-day check and one retry).

### Progress UI
Keep the existing `batchProgress` panel but:
- Always show it while the mutation is pending (currently it's guarded on `busy && batchProgress`).
- Add a shadcn `<Progress>` bar showing `done / total` percentage above the status counts.
- Add a "Retrying skipped paddocks…" line when the auto-retry pass is running.

### Header/toolbar cleanup
- Remove the two old buttons.
- Add one "Refresh Imagery" button with spinner + label states: idle "Refresh Imagery", running "Refreshing 3 / 12…", retry "Retrying skipped…".
- Keep the error banner + Retry action wired to the new unified mutation.

## Technical details

- File: `src/pages/tools/SatelliteMappingPage.tsx` only. No edge-function or DB changes; existing `satellite-search-scenes`, `satellite-process-scene`, and `satellite-backfill-analytical` cover the needs.
- New helpers inside the component:
  - `const STALE_DAYS = 3;`
  - `computeStalePaddockIds(paddocks, scenes, assets, layer)` returning `string[]`.
- Extend `checkForNewImage` mutation:
  - Accept `{ paddockIds?: string[]; isRetry?: boolean }` in `mutationFn` variables.
  - When `paddockIds` provided, filter `targetGeoms` to that set; otherwise fall back to today's logic (all vs single).
  - After the worker pool completes, if `!isRetry`, recompute stale set from the just-refetched scenes; if non-empty, call `mutation.mutate({ paddockIds: residual, isRetry: true })` from `onSuccess` before showing the final toast. Use a ref (`retryInFlightRef`) to suppress the intermediate toast.
- Auto-load effect:
  ```ts
  const autoRanForVineyardRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeVineyardId || scenesQuery.isLoading || !scenesQuery.data) return;
    if (autoRanForVineyardRef.current === activeVineyardId) return;
    const stale = computeStalePaddockIds(...);
    autoRanForVineyardRef.current = activeVineyardId;
    if (stale.length > 0) checkForNewImage.mutate({ paddockIds: stale });
  }, [activeVineyardId, scenesQuery.data, scenesQuery.isLoading]);
  ```
- Progress bar: import `Progress` from `@/components/ui/progress`; value = `(done/total)*100`.
- Retain existing concurrency-3 worker pool and per-paddock status map.
- Typecheck with `tsgo` after edits.

## Out of scope
- No changes to edge functions or database schema.
- No change to hover/cell-reading interaction.
- No change to layer legend or map zoom behaviour.
