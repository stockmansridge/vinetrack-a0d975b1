# Confirmation of current behaviour

Good news first — the page is **not** re-generating imagery it already has:

- `computeStalePaddockIds` only flags a paddock when it has no completed scene, its newest scene is >3 days old, or the selected non-true-colour layer is missing its analytical raster.
- The auto-run effect only calls `satellite-process-scene` for that stale set. Fresh paddocks are skipped entirely.
- `satellite-process-scene` itself is idempotent per `(scene, index, processing_version)` — it short-circuits Sentinel Hub render + storage upload when the asset row already exists.

So no paddock's PNG/GeoTIFF is being re-rendered on every visit.

# What is slow

Three things still happen from scratch every time the user opens the page:

1. **`satellite-list-scenes` refetches on every mount and window refocus.** Neither `useQuery` in `SatelliteMappingPage.tsx` sets `staleTime`/`gcTime`, so React Query defaults (`staleTime: 0`) apply and the scenes + assets + summaries payload is refetched even if the user just navigated away for a moment.
2. **Signed storage URLs are re-signed every mount.** `signedUrls` lives in `useState`, so the moment the component unmounts (route change) all URLs are dropped and every visible asset hits `satellite-get-asset-url` again on the next visit.
3. **The auto-run effect still fires `satellite-process-scene` for stale paddocks even if that was already done seconds ago in another tab / previous mount.** The guard is a `useRef` that resets on unmount, so hopping in and out of the page repeatedly re-runs coverage checks and DB upserts (cheap per call, but adds latency when many paddocks are involved).

Together these produce the "takes too long each time I open it" feeling even though nothing new is being generated.

# Plan (frontend only, no edge-function or DB changes)

### 1. Cache the scenes/assets query
In `SatelliteMappingPage.tsx`, on both `useQuery` calls (`satellite-paddocks` and `satellite-scenes`):

- `staleTime: 5 * 60_000` (5 min) — scenes only change when we process them, and we invalidate the query after a successful refresh mutation anyway.
- `gcTime: 30 * 60_000` (30 min) — keep the payload warm across brief navigations.
- `refetchOnWindowFocus: false` — no need to refetch on tab focus for a page whose data source is our own DB.

### 2. Cache signed URLs across mounts
Replace the `useState<Record<string,string>>` signed-URL cache with a **React Query cache keyed by asset id**:

- New helper `useSignedAssetUrl(assetId)` using `useQuery(["satellite-signed-url", assetId], …)` with `staleTime` set to slightly less than the signing TTL (inspect `satellite-get-asset-url` to pick a safe value; default to 50 min if the TTL is 1 h) and `gcTime` an hour.
- Signed URLs then survive route changes; revisiting the page shows tiles immediately without re-signing every asset.

### 3. Persist the "auto-ran for vineyard" guard across mounts
Move `autoRanForVineyardRef` out of `useRef` into a module-level `Map<string, number>` (vineyardId → timestamp). Only auto-run when the last auto-run for that vineyard was more than, say, 10 minutes ago. That keeps the self-healing behaviour but stops it from firing again when the user just briefly navigated away.

### 4. Small correctness follow-ups while we're here
- After the `checkForNewImage` mutation completes, we already `invalidateQueries` on scenes; make sure the auto-run guard is only set **after** we know we've actually kicked off a refresh (so a failed session can still retry on the next visit).

# Out of scope
- No edge-function changes.
- No DB / RLS changes.
- No changes to map rendering, legend, or layer selection.
- Larger architectural moves (prefetching from Dashboard, service-worker caching of tiles) — happy to plan those separately if the above isn't enough.

# Technical notes
- Files touched: `src/pages/tools/SatelliteMappingPage.tsx` only.
- Verify with `tsgo` after edits.
- Manual check: open the page, navigate away, come back — network panel should show no `satellite-list-scenes` or `satellite-get-asset-url` calls within the stale window.
