# Crop Health Maps imagery ingestion — audit and provider-independent design (rev 2)

Design only. Nothing here is implemented, migrated, scheduled or deployed. No live provider requests were made for this revision. Map layout and diagnostic UI stay unchanged. Historical imagery, permissions and production data are preserved by every stage.

Goal: a reliable daily background imagery service that does not depend permanently on Copernicus Sentinel Hub.

Evidence legend: **[code]** confirmed in repository source; **[supplied]** production figure supplied by the owner, not re-queried; **[docs]** provider documentation statement; **[confirm]** must be verified in the benchmark (section 11) before relying on it.

## 1. Audit findings (unchanged from rev 1)

- **[code]** `supabase/functions/_shared/satellite-cdse.ts:650-652` — `fetchWithRetry` multiplies `Retry-After` by 1000 (treats it as seconds), capped at 20 s.
- **[code]** `satellite-cdse.ts:72-98` — layer native resolutions: TRUE_COLOUR, NDVI, EVI, GNDVI, MSAVI, GCI = 10 m (B02/B03/B04/B08); NDRE, RECI, RENDVI, NDMI, PSRI = 20 m (use at least one of B05/B06/B8A/B11).
- **[code]** `satellite-process-scene/index.ts:150,176` — writes `satellite_scenes.spatial_resolution_m: 10` for every scene, including 20 m layers.
- **[code]** `satellite-process-scene` renders all 11 layers in one invocation against the ~150 s edge limit; a timeout leaves a partial scene.
- **[code]** `satellite-backfill-run` / `-discover` require a System Admin and forward the human `Authorization` header (`backfill-run:83,151`) — they cannot run unattended.
- **[code]** `src/components/satellite/BackfillPanel.tsx:49-59` loops only while the page is open; copy at line 160 says "in the background" (incorrect).
- **[supplied]** Last scene 1 Aug 2026; 125 scene rows; pg_cron, pg_net and Vault installed; no satellite cron job; one backfill job stuck `processing`; 337 pending expected dates.
- **[code]** `satellite_expected_dates.outcome = 'downloaded'` is date-level and can be set while layers are missing.

## 2. Provider-independent architecture

Three separable components behind one queue. The Crop Health page reads only VineTrack tables and storage, never a provider directly, so swapping or adding providers never changes the page.

```text
             +-------------------------+
 cron  --->  | Discovery (per provider)|  catalogue only, no pixels
             +-----------+-------------+
                         | candidate acquisitions + paddock-local quality
                         v
             satellite_acquisitions  ->  satellite_work_items (queue, lanes, leases)
                                                  |
                                   worker claims one item
                                                  v
             +-------------------------+   +--------------------------+
             | SpectralAccess          |-->| Processor (provider-free)|
             | (per provider: bands,   |   | indices, clip, stats,    |
             |  masks, scale/offset)   |   | verify, write assets     |
             +-------------------------+   +--------------------------+
                                                  |
                         satellite_raster_assets / summaries / manifest (existing)
```

### 2.1 Interfaces (TypeScript, proposed `supabase/functions/_shared/imagery/types.ts`)

```ts
export type ProviderId = "copernicus_sh" | "earth_search" | "dea";

export interface AcquisitionRef {
  provider: ProviderId;
  collection: string;            // e.g. "sentinel-2-l2a", "ga_s2bm_ard_3"
  productId: string;             // provider's original item/product ID, verbatim
  platform: "sentinel-2a" | "sentinel-2b" | "sentinel-2c" | string;
  acquiredAt: string;            // sensing time UTC from provider metadata
  processingBaseline: string | null; // e.g. "05.10"; null only when provider omits it
  tileId: string | null;         // MGRS tile / DEA region code
  sourceCrs: string;             // e.g. "EPSG:32755"
  sceneCloudPct: number | null;  // informational only
}

export interface PaddockQuality {
  validPixelPct: number;         // inside the real paddock polygon
  cloudPct: number;
  shadowPct: number;
  maskMethod: string;            // "SCL", "s2cloudless", "fmask", ...
  pixelCount: number;
}

export interface DiscoveryProvider {
  id: ProviderId;
  search(aoi: GeoJSON.Polygon, from: string, to: string): Promise<AcquisitionRef[]>;
  paddockQuality(ref: AcquisitionRef, paddock: GeoJSON.Polygon): Promise<PaddockQuality>;
}

export interface BandRaster {
  band: string;                  // provider-neutral name: "blue","red","nir","rededge1",...
  sourceBand: string;            // provider asset key: "B04", "red", "nbart_red"
  nativeResolutionM: 10 | 20 | 60;
  data: Float32Array;            // surface reflectance AFTER scale/offset
  scaleApplied: number; offsetApplied: number;
  width: number; height: number; transform: number[]; crs: string;
}

export interface SpectralAccessProvider {
  id: ProviderId;
  /** Must read every band from exactly `ref.productId`. Never mosaics silently. */
  readBands(ref: AcquisitionRef, paddock: GeoJSON.Polygon, bands: string[],
            resolutionM: 10 | 20): Promise<{ bands: BandRaster[]; mask: Uint8Array;
            reflectanceCorrection: string; costEstimate: ProviderCost }>;
}

export interface ProviderCost { processingUnits: number; requests: number;
  bytesTransferred: number; }

export interface Processor {
  algorithmVersion: string;      // e.g. "vt-indices/3.0.0"
  render(layer: string, input: Awaited<ReturnType<SpectralAccessProvider["readBands"]>>,
         paddock: GeoJSON.Polygon): Promise<ProcessedAsset[]>;
}
```

The Processor is provider-free: it receives reflectance already scaled, so index formulas exist once. Copernicus is the first adapter (wrapping current Evalscript calls; with Sentinel Hub the band maths can stay server-side, but the adapter still returns the same provenance). Earth Search and DEA adapters read Cloud-Optimised GeoTIFFs with range requests and feed the same Processor.

### 2.2 Required provenance per asset

Every `satellite_raster_assets` row records: provider, collection, original product ID, platform, processing baseline, band source (provider asset keys used), cloud-mask method, reflectance correction (e.g. `L2A_BOA_sen2cor`, `NBART`), scale/offset applied, native resolution, source CRS, display CRS and display resolution, algorithm version, and contributing product IDs (exactly one unless an explicit, labelled mosaic).

## 3. Provider comparison

Values marked **[confirm]** must be measured in section 11 for our paddocks before any decision.

| Aspect | Copernicus Sentinel Hub (CDSE) | Element 84 Earth Search (AWS) | Digital Earth Australia (DEA) |
|---|---|---|---|
| Product | Sentinel-2 L2A (Sen2Cor BOA) via Process/Statistics APIs | `sentinel-2-l2a` COGs on AWS Open Data, STAC API | `ga_s2am/bm/cm_ard_3` NBART + fmask, STAC + COGs |
| Sentinel-2A/B/C | A, B, C **[confirm C in our window]** | A, B, C **[confirm C]** | A, B, C as separate collections **[confirm C]** |
| Native bands | 10 m B02/B03/B04/B08; 20 m B05/B06/B07/B8A/B11/B12 | same native bands as COGs | same bands, Australia-wide, GA-processed |
| Latency after sensing | typically hours **[confirm]** | typically hours to ~1 day **[confirm]** | NRT product within ~1–2 days, final ARD later **[confirm]** |
| Quality mask | SCL, CLM/CLP (s2cloudless), dataMask | SCL asset per item | fmask, s2cloudless, NBART contiguity |
| Processing we must do | minimal (server-side Evalscript) | read COGs, apply scale/offset, reproject, clip, mask, compute indices | read COGs, reproject, clip, mask, compute indices |
| Service limits | processing units + requests per minute/month by plan **[confirm account]** | no API key; STAC rate limits; S3 egress from our worker | public, no key; fair-use limits **[confirm]** |
| Estimated cost | PU consumption against plan quota; overage per plan **[confirm]** | data free; cost = worker CPU + transfer **[confirm]** | data free; cost = worker CPU + transfer **[confirm]** |
| International vineyards | global | global | **Australia only** |
| Licence | Copernicus open licence | Copernicus licence (Element 84 hosts) | CC BY 4.0 (GA) **[confirm attribution text]** |

### 3.1 Non-interchangeability rules

- **DEA NBART vs Copernicus L2A:** NBART includes BRDF and terrain illumination correction; Sen2Cor L2A does not apply the same correction. Index values from the two must **not** be assumed numerically interchangeable. A paddock's time series is single-provider by default; switching provider inserts a recorded series break (`reflectance_correction` changes) shown in diagnostics, and percentile classes are computed per provider series.
- **Earth Search scale/offset:** reflectance DNs must be converted using each asset's STAC `raster:bands[].scale` and `offset` (processing baseline 04.00+ carries offset −0.1 with scale 0.0001). The adapter reads these per item; it never hard-codes them, records the values applied, and fails the item if the metadata is absent rather than guessing.
- Copernicus Sentinel Hub harmonises baseline offsets in its L2A collection by default **[docs, confirm with `harmonizeValues`]**; the adapter records whether harmonisation was on.

## 4. Processing budget (replaces the 200-unit daily quota)

Rev 1's `max_units_per_day = 200` is insufficient: one complete acquisition across eight paddocks can need ~248 work units (8 paddocks × 11 layers × display + analytical + summary ≈ 264, less shared summaries). A fixed unit count also hides the real constraints.

### 4.1 Budget dimensions (tracked per provider per day and per minute)

| Dimension | Source | Enforcement |
|---|---|---|
| Provider processing units (CDSE PU) | adapter `costEstimate`, reconciled with response headers where available | hard daily and monthly cap per provider |
| Provider requests | counted per call | per-minute token bucket (global across workers) |
| Worker execution time | measured per item | per-run wall-clock budget (e.g. 60 s), daily CPU-seconds cap |
| Transfer bytes | adapter | daily cap (relevant for COG providers) |
| Storage bytes | written asset sizes | per-vineyard soft cap + alert |

`satellite_provider_budget` holds limits and running totals; `reserve_budget(provider, estimate)` is atomic and returns allowed/denied.

### 4.2 Lanes and priority

- **Fresh lane** — acquisitions sensed in the last 10 days. Reserved share of every budget (default 70%, configurable). Order: True Colour + NDVI for all paddocks first, then remaining 10 m indices, then 20 m indices.
- **Backfill lane** — older acquisitions, newest first. Uses only budget left after the fresh lane's reservation **and** only when the fresh lane queue is empty. Backfill can never delay fresh imagery.
- Retry items keep their lane; dead items leave the queue.

## 5. Resolution and provenance (strict)

- 10 m layers (TRUE_COLOUR, NDVI, EVI, GNDVI, MSAVI, GCI) are measured from native 10 m bands at 10 m.
- 20 m layers (NDRE, RECI, RENDVI, NDMI, PSRI) are measured at native 20 m. Where a formula mixes 10 m and 20 m bands, the 10 m bands are aggregated to 20 m and the asset is 20 m.
- Statistics are always computed on the native measurement grid, never the display grid.
- EPSG:3857 display output is a rendering choice: assets store `native_resolution_m`, `display_resolution_m`, `display_crs`. The UI/diagnostics never call a layer "10 m" because it is displayed on a 10 m grid.
- `satellite_scenes.spatial_resolution_m` becomes informational and is not used for any resolution claim; per-asset metadata is authoritative.
- **Single-acquisition rule:** every band of one asset must come from one `productId`. Copernicus requests use a time window bounded to that acquisition plus `mosaickingOrder` with a product filter **[confirm exact filter mechanism]**; COG adapters open only that item's assets. If a paddock straddles two tiles of the same pass, the composite is allowed only when both items share the sensing datatake, and every contributing product ID is recorded. Cross-date mosaics are refused.

## 6. Completeness, freshness and quality

Four separate, independently reported values per paddock (and rolled up per vineyard) in `satellite_freshness`:

1. `last_provider_check_at` — last successful discovery call (proves the service is alive).
2. `newest_discovered_acquisition` — newest acquisition seen in the catalogue, regardless of cloud.
3. `newest_usable_acquisition` — newest acquisition passing paddock-local quality thresholds.
4. `newest_complete_acquisition` — newest date with every required layer and asset kind stored and verified.

Quality: cloud, shadow and valid-pixel percentages are computed inside the actual paddock polygon (not bbox, not scene). Default usable threshold: valid ≥ 80% and cloud+shadow ≤ 10% **[confirm in benchmark]**. A date is `downloaded` only when all required assets exist and pass verification (object exists, size > 0, dimensions/transform match, analytical header parses, statistics row present). Otherwise `partial` with the missing list, or `cloud_obscured` with measured values.

## 7. Scheduling and security

- **Auth:** pg_cron + pg_net call `satellite-discover` and `satellite-worker` with a dedicated cron secret stored in Vault (read inside the cron SQL via `vault.decrypted_secrets`) and checked by the function against an edge secret. No human JWT is ever forwarded; existing admin-only functions stay admin-only.
- **Atomic claims:** `claim_work_item(worker, lease)` uses `FOR UPDATE SKIP LOCKED`, ordered by lane, priority, acquisition date desc; it reclaims items whose `lease_expires_at` has passed.
- **Lease expiry:** workers heartbeat long items; expired leases return to `pending` with `attempts + 1`.
- **Idempotent recovery:** idempotency key `(paddock_id, provider, product_id, index_type, asset_kind, algorithm_version)`; asset writes are upserts on that key, storage paths are deterministic, so a re-run overwrites rather than duplicates. Historical assets at older algorithm versions are kept.
- **Global provider throttle:** `satellite_provider_throttle` (per provider: `next_allowed_at`, `retry_after_until`, tokens) consulted before every provider call by every worker.
- **Kill switch:** `satellite_ingestion_control` row (global `enabled`, per-provider `enabled`, reason, changed_by/at). Checked at function start and before each claim; defaults to off. Per-vineyard opt-in remains in settings.
- **Cadence:** discover once daily; worker every 10 min only while items are pending (unschedules itself when the queue drains and is re-armed by discover), so there is no permanent sweeper.

## 8. Copernicus Retry-After correction (specified, not implemented)

**[docs]** CDSE Sentinel Hub documents numeric `Retry-After` values in milliseconds.

Narrow change in `_shared/satellite-cdse.ts`, `fetchWithRetry` only:

- numeric header → milliseconds as given (no × 1000);
- HTTP-date header → `date − now`;
- missing/invalid → existing exponential backoff;
- clamp to [250 ms, caller cap]; if wait exceeds the remaining run budget, stop and record `retry_after_until` instead of sleeping.

Automated tests: `"5000"` → 5000 ms; `"0"` → 250 ms floor; HTTP date 30 s ahead → ~30 000 ms; missing header → backoff; `"abc"` → backoff; `"999999999"` → clamped and deferred, not slept.

## 9. Schema and interface changes (proposed SQL outline, not applied)

All additive; existing columns keep their meaning; historical rows untouched (new columns nullable, historical rows get `provider = 'copernicus_sh'` only via a reviewed backfill).

- `satellite_scenes` + `provider`, `collection`, `provider_product_id`, `platform`, `processing_baseline`, `tile_id`, `source_crs`, `datatake_id`. `COMMENT ON COLUMN spatial_resolution_m IS 'DEPRECATED for claims: use satellite_raster_assets.native_resolution_m'`.
- `satellite_raster_assets` + `native_resolution_m`, `display_resolution_m`, `display_crs`, `source_crs`, `band_source jsonb`, `cloud_mask_method`, `reflectance_correction`, `scale_offset jsonb`, `algorithm_version`, `contributing_product_ids text[]`, `verified_at`, `byte_size`.
- New `satellite_acquisitions` (provider-neutral catalogue record + paddock quality per paddock).
- New `satellite_work_items` (lane, priority, status, attempts, next_attempt_at, lease_owner, lease_expires_at, idempotency key unique, cost estimate/actual).
- New `satellite_provider_budget`, `satellite_provider_throttle`, `satellite_ingestion_control`, `satellite_freshness`, `satellite_ingest_runs`.
- Functions (SECURITY DEFINER, `search_path=public`, EXECUTE service_role only): `claim_work_item`, `heartbeat_work_item`, `complete_work_item`, `reserve_budget`, `record_provider_backoff`, `refresh_freshness`.
- Every new table: GRANT to service_role (+ authenticated SELECT only where the existing admin gate requires), RLS enabled, policies matching current satellite tables.
- Code: `_shared/imagery/types.ts`, `_shared/imagery/copernicus.ts` (wraps current calls), later `earthSearch.ts`, `dea.ts`; `_shared/imagery/processor.ts` (provider-free index maths).

## 10. Monitoring and alerts

Diagnostics data (UI unchanged now): the four freshness values, queue depth per lane, budget used, 429 counts, dead items. Alerts: no successful discovery in 24 h; fresh lane non-empty > 24 h; usable acquisition exists but not complete within 48 h; provider paused > 6 h; budget > 90%.

## 11. Read-only provider benchmark and acceptance

Scope: 60–90 days for Stockman's Ridge (plus other test vineyards for non-Australian or cloudier cases). **Catalogue/metadata only** until separately approved — no pixel requests, no worker activation.

Measured per provider:

| Metric | Acceptance threshold (proposed) |
|---|---|
| Scene discovery | ≥ 98% of expected Sentinel-2A/B/C passes found vs the union of all providers |
| Asset availability | 100% of required bands + mask present for discovered items |
| Cloud-free paddock coverage | usable-date count within 1 of best provider |
| Native resolution | 100% of assets record correct 10/20 m; zero 20 m layers labelled 10 m |
| Failures | < 2% items dead after retries |
| Retries | < 10% of calls retried; zero 429 storms (> 5 consecutive) |
| Ingestion latency | fresh usable acquisition complete ≤ 48 h after provider publication |
| Estimated cost | within approved monthly cost per paddock |

A later, separately approved stage repeats the comparison with pixel reads on a few dates to quantify NBART vs L2A index differences.

## 12. Ordered implementation plan and approval gates

1. **Gate A** — approve this revised design.
2. Retry-After correction + tests (code only, no behaviour switch).
3. **Gate B** — approve additive schema migration (kill switch off, no cron).
4. Provider interfaces + Copernicus adapter refactor with parity tests; no change to outputs.
5. **Gate C** — approve read-only metadata benchmark (section 11).
6. Queue, leases, budgets, throttle, kill switch, freshness — deployed disabled.
7. **Gate D** — enable unattended schedule for Stockman's Ridge only; 14-day field test against section 11 thresholds.
8. **Gate E** — optional Earth Search / DEA adapters (pixel benchmark first).
9. **Gate F** — wider opt-in rollout; retire page-driven backfill loop and correct its copy.

## 13. Unknowns

- CDSE account PU/request quotas and overage cost.
- Exact Sentinel-2C coverage and latency per provider for our paddocks.
- Copernicus mechanism to pin one product ID inside a Process request.
- DEA fair-use limits and attribution wording; DEA cannot serve non-Australian vineyards.
- Edge worker CPU/memory limits for COG decoding of larger paddocks.
- Vault secret access pattern from cron on this project.
- Stable read path for paddock geometry from the VineTrack backend.
- Desired history depth and monthly budget per vineyard (business decision).
