# Crop Health Maps imagery ingestion — audit and provider-independent design (rev 3 — Gate A not approved)

Design only. Nothing here is implemented, migrated, scheduled or deployed. No live provider requests were made for this revision. Map layout and diagnostic UI stay unchanged. Historical imagery, permissions and production data are preserved by every stage.

Goal: a reliable daily background imagery service that does not depend permanently on Copernicus Sentinel Hub.

Revision 3, 19 October 2026: **Gate A remains unapproved.** This revision changes this document only. Read-only PostgreSQL catalogue metadata and public provider documentation were inspected; no application-table rows, imagery APIs, DDL, schedules or deployed functions were changed.

Evidence legend: **[code]** confirmed in repository source; **[supplied]** production figure supplied by the owner, not re-queried; **[catalog]** live Portal imagery database catalogue metadata inspected this revision; **[docs]** provider documentation statement; **[confirm]** must be verified in the benchmark (section 11) before relying on it.

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
                         | candidate acquisitions (quality awaits pixel stage)
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
export type ProviderId = "CDSE_SENTINEL_HUB" | "earth_search" | "dea"; // preserve existing DB value

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
  // Discovery is metadata-only. Measured paddock quality belongs to Processor.
}

export interface BandRaster {
  band: string;                  // provider-neutral name: "blue","red","nir","rededge1",...
  sourceBand: string;            // provider asset key: "B04", "red", "nbart_red"
  nativeResolutionM: 10 | 20 | 60;
  data: Float32Array;            // surface reflectance AFTER scale/offset
  scaleApplied: number; offsetApplied: number;
  width: number; height: number; transform: number[]; crs: string;
  sourceProductId: string; assetIdentity: string; checksum: string | null;
  sourceGrid: GridRef; measurementGrid: GridRef; resampling: string;
}
export interface GridRef {
  crs: string; affine: [number, number, number, number, number, number];
  width: number; height: number; cellSizeM: number; pixelConvention: "area";
  // Affine convention: x=a*col+b*row+c, y=d*col+e*row+f (pixel corners).
}
export interface SourceProof {
  contractVersion: 1; requestedProductIds: string[]; observedProductIds: string[];
  datatakeId: string | null; requestHash: string; manifestHash: string;
  proofMethod: "verified_tile_selection" | "individual_product_assets";
}

export interface SpectralAccessProvider {
  id: ProviderId;
  /** Must read every band from exactly `ref.productId`. Never mosaics silently. */
  readBands(ref: AcquisitionRef, paddock: GeoJSON.Polygon, bands: string[],
            resolutionM: 10 | 20): Promise<{ bands: BandRaster[]; mask: Uint8Array;
            reflectanceCorrection: string; sourceProof: SourceProof;
            measurementGrid: GridRef; costEstimate: ProviderCost }>;
}

export interface ProviderCost { processingUnits: number; requests: number;
  bytesTransferred: number; }

export interface Processor {
  processingVersion: string;     // existing DB processing_version is the sole version key
  render(layer: string, input: Awaited<ReturnType<SpectralAccessProvider["readBands"]>>,
         paddock: GeoJSON.Polygon): Promise<ProcessedAsset[]>;
}
```

The Processor is provider-free: it receives correctly decoded reflectance on the measurement grid, one source proof and categorical masks. It calculates paddock quality, indices and statistics from the same numerical cells, then generates display assets. Copernicus is the first adapter, **not an unconditional wrapper around current day-window requests**: the exact-source contract in section 5.2 must pass first. Server-side Evalscript maths are admissible only with proven equivalent source/grid/mask semantics; otherwise use individually addressed product bands and the shared Processor. Earth Search and DEA remain optional future adapters, not activated by this design.

### 2.2 Required provenance per asset

Every `satellite_raster_assets` row records: provider, collection, original product ID, platform, processing baseline, band source (provider asset keys used), cloud-mask method, reflectance correction (e.g. `L2A_BOA_sen2cor`, `NBART`), scale/offset applied, native resolution, source CRS, display CRS and display resolution, processing version (existing `processing_version`), source/measurement/output grids and transforms, and contributing product IDs (exactly one unless an explicit, labelled mosaic).

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

## 5. True measurement resolution and exact provenance (activation blockers)

### 5.1 Measurement grid is not the map grid

**[code]** Current code requests EPSG:3857 rasters and describes them as native; `NEAREST` alone does not make a projected 10 m pixel a native Sentinel cell. Do not retroactively correct, relabel or recompute historical assets. New processing has a distinct version and truthful metadata.

- Read native tile CRS (normally UTM), affine transform, corner origin, pixel convention and band values from the exact product metadata/header. Record per-band **source grids**, the **measurement grid**, and the **output grid** separately. A cropped raster retains an integer-cell offset from its source grid; it never snaps to an arbitrary paddock bbox origin.
- TRUE_COLOUR, NDVI, EVI, GNDVI, MSAVI and GCI use B02/B03/B04/B08 native 10 m cells. NDRE, RECI, RENDVI, NDMI and PSRI use a native 20 m grid anchored to the relevant 20 m band, never a 10 m upsampled grid.
- For mixed inputs, aggregate aligned 10 m reflectance cells to the corresponding 20 m cell by area-weighted mean **before** computing the index (not averaging already-computed indices). On an aligned tile this is a 2×2 mean. Require all contributing cells to be valid in the initial conservative rule; otherwise mark no-data. Record kernel, mask rule, source/destination transforms and grid IDs. This proposed rule needs fixture/field acceptance; it is not asserted to match the current provider resampling.
- Categorical SCL is native 20 m: preserve labels, use containing-parent/nearest categorical lookup at 10 m; never bilinearly interpolate mask codes or claim 10 m cloud-boundary precision. Record mask resolution separately. Mask, dataMask and finite-value validity participate in the same statistics sample set.
- Reproject the real boundary to the measurement CRS. Initial analysis inclusion rule: cell centre inside polygon, holes excluded, deterministic boundary tie rule. Report included-cell counts and valid/cloud/shadow fractions with an explicit denominator. Missing coverage is not automatically cloud. Alternative fractional-area weighting requires an explicitly versioned change, not a silent switch. Display edge alpha is separate and cannot weight analysis.
- Compute min/max/mean/stddev/median/percentiles and quality **once on analytical cells**. Produce EPSG:3857 overlays afterwards. Display smoothing/reprojection may change pixels but never analytical arrays, summaries or hover numerical source. Existing analytical-reader assumptions about map bounds need an approved compatibility adaptation before new assets reach the unchanged page; no UI redesign is authorised here.
- Cross-paddock crops on the same tile share identical cell boundaries and values at shared cells. For an authorised same-pass multi-tile case, retain native tile subgrids; use a deterministic overlap owner so statistics never double-count. Cross-zone tiles are not silently described as one native UTM grid: keep per-tile measurements and combine samples, or block that case until the representation and reader are approved.

**Concrete acceptance (future tests, not run):** known UTM pixel corner/centre transforms round-trip to WGS84 within 0.05 m against an independent geospatial reference; crop origins are exact integer cell offsets; 10/20 m affine lengths match headers within 1e-6 m; a 4×4 10 m fixture maps to an aligned 2×2 20 m fixture with hand-computed means; adjacent/overlapping paddocks yield identical shared-cell values and centres (1e-6 m alignment tolerance); holes/boundary ties give exact expected sample counts; coordinate sampling selects the expected cell; changing display size, reprojection or smoothing leaves analytical hashes and summaries unchanged. Mixed-resolution layers must remain labelled 20 m even on 10 m display pixels. Include tile seams, rotated affine rejection/support and both hemispheres. Position tolerance verifies processing alignment, not satellite geolocation accuracy.

### 5.2 Exact acquisition/source contract

**[code]** `_shared/satellite-cdse.ts:660–825` sends a day-window `timeRange` and `mosaickingOrder: leastCC` for separate Process/Statistics requests. Neither the saved `provider_scene_id` nor its diagnostic echo proves the returned pixels came from that product. This is an unresolved **activation blocker**, including for statistics and quality checks.

No invented `productId` dataFilter is permitted. Supported-mechanism research and a fail-closed request/fallback contract are specified below; documentation alone is not runtime proof. Every band, mask, index, summary and display derivative must reference the same immutable source manifest/hash and processing version. Any unexpected/missing source identity fails the work item before publication. Narrowing a time interval, choosing leastCC or matching a calendar date is insufficient.

Single-product is default. A multi-tile mosaic requires separate explicit authorisation, proven same sensing datatake/pass (not just same day), exact allowed product IDs, tile footprints, seam/overlap ownership and contributor records per output. Refuse cross-pass/date mosaics and unavailable datatake proof. Provider item IDs and original product identifiers may differ: preserve a verified mapping, never substitute names without evidence.

#### Documented CDSE mechanisms and their limits

Public documentation inspected for this revision (not authenticated imagery requests):

- [Evalscript functions](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Evalscript/Functions.html): `mosaicking: "TILE"` exposes corresponding `samples[i]` / `scenes.tiles[i]`; `preProcessScenes(collections)` may filter `collections.scenes.tiles`, preserving the documented collection structure. Tile metadata can include `date`, `dataPath`, `shId`; availability depends on collection/context. This is scene filtering inside Evalscript, **not a documented `productId` request filter**.
- [Process metadata output](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/UserGuides/Metadata.html): `updateOutputMetadata` may populate `outputMetadata.userData`; Process can request a `userdata` JSON response alongside raster responses. Available-scene metadata is not proof of which scene supplied each pixel. Neither `date` nor internal `shId` is documented here as an immutable original SAFE-product identifier or unique datatake key.
- [Statistical API](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Statistical.html): TILE/ORBIT mosaicking and output `dataMask` are supported; aggregation mosaics within intervals (minimum one day). These docs do not establish a Process-style returned provenance sidecar or an atomic source snapshot shared across separate Process/Statistics calls. Do not invent either guarantee or claim hooks categorically unsupported. **Authoritative new statistics are computed from the accepted analytical raster**, not trusted merely because an independent Statistics call used the same time range.
- [Sentinel-2 L2A processing](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/S2L2A.html): native band resolutions, interpolation and `harmonizeValues` semantics are documented. Explicitly record units/harmonisation; default harmonisation can clamp negative reflectance. Confirm exact baseline/offset behaviour using approved fixtures and later bounded calls, never apply offset twice.

**Conditional verifiable Process request contract (Gate V experiment):** freeze collection, verified original-product-to-tile mapping, expected `(dataPath, shId, date)` tuple(s), source-manifest hash, bands/mask, harmonisation/units, native CRS/affine-aligned extent/dimensions and resampling. Send documented `input.data[].type`, `dataFilter.timeRange` (candidate narrowing only), processing options, Evalscript TILE plus exact allowlist scene filtering, and raster + `userdata` responses. `evaluatePixel` selects only the allowlisted sample, emits no-data if absent, and emits an additional source-index raster; never fall through to another least-cloudy sample. Sidecar records selected identities/request hash; the source-index raster proves the supplying tile for every valid pixel. Each band's supplying sample must match the manifest. Reject ambiguous/missing mappings, unexpected contributors, incomplete source output or inability to prove native grid alignment. A source list alone, a narrow time window or a diagnostic ID echo does not pass. This contract is proposed and **not yet proven on CDSE**; no claim that `dataPath` is immutable or `shId` equals a product UUID.

**Explicit fallback if the contract cannot be proved:** use documented [OData product-node access](https://documentation.dataspace.copernicus.eu/APIs/OData.html) or [S3 object access](https://documentation.dataspace.copernicus.eu/APIs/S3.html) to address individual Sentinel-2 SAFE product/granule bands and SCL. Freeze original product UUID/name, datatake/granule metadata, processing baseline, exact object keys, headers and cryptographic content hashes. Decode JP2/other delivered bands using product quantification/BOA offset and no-data metadata, then apply the explicitly chosen harmonisation policy. All derivatives and local statistics come from those frozen objects. An ETag alone is not presumed a cryptographic checksum. Access permissions, partial-read support, transfer cost, worker decoding limits and object availability require later approval/verification. Missing/changed objects fail closed, never substitute another product/provider. This fallback is a design option, not a switch or provider request now.

**Source acceptance tests (later):** two same-day products with deliberately different band values; reversed candidate order; leastCC favouring the wrong product; reprocessed baseline with changed identity; absent/ambiguous tile mapping; missing mask/band; contributor substitution in only one layer; and cross-pass tiles. Assert all 11 derivatives and all ten summaries carry one accepted manifest hash and correct expected values; unexpected sources produce no published assets. A separately authorised same-pass multi-tile fixture proves datatake, exact contributor set and seam ownership. Repeat separate requests after catalogue change and verify unchanged accepted sources or explicit failure. An independent Statistics result is never accepted without equivalent source proof; local raster-derived statistics are the default.

### 5.3 Golden numeric/visual parity fixtures — planned, not executed

Freeze the current `sentinel2-v6-native-10m` formula/Evalscript version as the legacy oracle; immutable offline fixture assets have hashes, band-specific values, native headers, acquisition/baseline metadata and expected sample sets. Use two comparisons: **same input/grid/mask** to verify formula portability, and **current projected processing versus corrected native processing** to quantify intentional grid/mask differences. The latter is not expected to be automatically equal. Capture any required real-provider reference rasters only in separately approved Gate V; synthetic offline fixtures are test data, never production imagery. DEA NBART is not a Copernicus parity oracle.

| Layer | Current formula / native measurement grid |
|---|---|
| TRUE_COLOUR | RGB B04/B03/B02 ×255×2.5, UINT8 saturation, dataMask alpha; 10 m, visual test only |
| NDVI | `(B08-B04)/(B08+B04)`; 10 m |
| EVI | `2.5*(B08-B04)/(B08+6*B04-7.5*B02+1)`; 10 m |
| GNDVI | `(B08-B03)/(B08+B03)`; 10 m |
| MSAVI | `(2*B08+1-sqrt((2*B08+1)^2-8*(B08-B04)))/2`; 10 m |
| NDRE | `(B08-B05)/(B08+B05)`; 20 m after B08 aggregation |
| RECI | `B08/B05-1`; 20 m after B08 aggregation |
| GCI | `B08/B03-1`; 10 m |
| RENDVI | `(B8A-B05)/(B8A+B05)`; 20 m |
| NDMI | `(B08-B11)/(B08+B11)`; 20 m after B08 aggregation |
| PSRI | `(B04-B02)/B06`; 20 m after B04/B02 aggregation |

Compare independent formula oracles against legacy Evalscript evaluation and proposed Processor outputs; do not compare an implementation to itself. Cover every SCL class (numeric exclusions `{0,1,3,8,9,10,11}`), dataMask, negative reflectance, NaN/Infinity, no-data sentinel `-9999`, zero/near-zero denominators around `1e-6`, EVI's existing **exact-zero** exception, negative MSAVI radicands, extremes and colour-ramp boundaries. True Colour currently ignores SCL while numeric display paints cloud/no-data differently from analytical validity; preserve that distinction in the parity oracle. Current Statistics mask can remain valid for a nonfinite formula result: explicitly test and document any corrected finite-value exclusion as a versioned difference, not hidden parity.

Include pre/post baseline 04.00 fixtures, per-band scale/offset/no-data application, harmonisation on/off and negative clamping, double-offset rejection, distinct 10/20 m patterns, 2×2 aggregation, categorical-mask parent lookup, valid/partial coverage, boundary holes/slivers, clipping and adjacent tile/paddock alignment. Percentile estimator, weighting, stddev convention and invalid-sample exclusion must be fixed and recorded; differences from provider estimators are quantified before approval.

**Proposed pass tolerances on identical valid sample sets:** numeric cells and summary statistics `abs(error) <= 1e-6 + 1e-5*abs(reference)` after FLOAT32 encoding; fixture cell/valid/no-data/cloud counts and mask classes exact; coverage percentages <=1e-6 percentage points for identical denominators; decoded RGB/alpha <=1 UINT8 level per channel on the same grid with fixed rounding (mask class/alpha semantics exact). Hashes/identity and clipping membership exact. Near singularities use hand-computed finite/invalid classifications; no broad tolerance may hide a denominator or source error. Projected-vs-native or estimator differences get per-layer distribution reports and explicit acceptance/version decisions, never loosened thresholds to declare parity. Historical imagery is neither overwritten nor used as an assumed exact-source truth. **No parity tests were run in this design revision.**

## 6. Completeness, freshness and quality

Four separate, independently reported values per paddock (and rolled up per vineyard) in `satellite_freshness`:

1. `last_provider_check_at` — last successful discovery call (does not alone prove worker or scheduler health).
2. `newest_discovered_acquisition` — newest acquisition seen in the catalogue, regardless of cloud.
3. `newest_usable_acquisition` — newest acquisition passing paddock-local quality thresholds.
4. `newest_complete_acquisition` — newest date with every required layer and asset kind stored and verified.

Quality: cloud, shadow and valid-pixel percentages are computed inside the actual paddock polygon (not bbox, not scene). Default usable threshold: valid ≥ 80% and cloud+shadow ≤ 10% **[confirm in benchmark]**. A date is `downloaded` only when all required assets exist and pass verification (object exists, size > 0, dimensions/transform match, analytical header parses, statistics row present). Otherwise `partial` with the missing list, or `cloud_obscured` with measured values.

## 7. Scheduling and security — continuously registered, activation gated

**Proposed explicit timing trade-off:** after separate schedule/trial approval, keep one worker invocation every 10 minutes continuously registered: **144 runs/day**, plus one daily metadata discovery. No-op checks can keep the database running and incur database, invocation and logging costs even with no work. A daily-only worker is cheaper but can strand work until the next day; the proposed 10-minute interval bounds a due retry or late enqueue's scheduling delay to <10 minutes under healthy service, plus provider backoff, budget/queue wait and execution time. Monthly idle and active costs must be measured and approved. Nothing is registered now.

- Discovery and worker have stable independent schedule names; discovery **never arms/disarms** the worker. Draining, disabling vineyards, backoff and delayed retries **never unschedule it**. This is an intentional permanent time-based retry/recovery check, not a claim of zero-cost event-driven handling.
- Invocation order: validate machine auth → global kill switch → enabled providers/vineyards → provider backoff/budget → expired leases and due retries/queued units. If no eligible work, return immediately with a bounded `disabled`, `backoff`, `budget_blocked` or `idle` result, **zero provider calls and zero imagery fetches**. Disabled state does not claim or mutate work. Recover expired eligible leases atomically; do not strand them behind a pending-only filter.
- pg_cron + pg_net use a dedicated machine secret; candidate Vault-read pattern must be validated under the executing database role in an approved stage. No human sign-in token; existing admin functions and permission checks unchanged. Never log a schedule command/header containing a secret. Edge gateway and worker must both accept/validate the selected machine-auth path; do not assume it works because a schedule exists.
- Claims use `FOR UPDATE SKIP LOCKED`, provider-global throttle/budget reservations and a per-provider concurrency limit. Check the switch before each claim and external call. Recheck/release reservations if disabled; an already-sent call may finish, but cannot publish after disable without an explicitly permitted fenced completion. Kill switch is not cancellation of in-flight HTTP.
- Leases heartbeat and expire. Completion is fenced by `(work_id, lease_token)` so an expired worker cannot overwrite a newer attempt. Idempotency includes vineyard/paddock, exact acquisition or authorised mosaic identity, index/asset kind and `processing_version`. Immutable, versioned content paths plus checksum/readback verification prevent partial overwrites; same-key retries verify an existing output instead of duplicating it. No overwriting older imagery versions.
- Numeric Retry-After deadlines persist globally; due retries, late discoveries and crash recovery remain eligible for the next registered invocation. Daily discovery uses an overlapping watermark and idempotent enqueue to catch late catalogue arrivals. Neither relies on a human browser being open.

### 7.1 Registration is not health proof

In an approved isolated trial, verify exactly one active worker schedule with the expected cadence/target and one discovery schedule using redacted catalogue inspection. Then correlate scheduled-run records, pg_net HTTP result (including auth failures/timeouts), worker start/end/idle heartbeat and run ID. A successful cron SQL enqueue is **not** proof of successful HTTP delivery or processing. An existing job row is **not** proof of any execution.

Require multiple real observed scheduled invocations, including idle/no-provider runs, and a worker receipt/completion heartbeat before marking scheduler healthy. Alert on missing schedule, inactive/duplicate/wrong target, no invocation receipt for >20 minutes plus approved clock/dispatch grace, repeated delivery/auth failure, missing completion/expired lease and daily discovery missing >24 hours plus grace. Monitor heartbeat independently of imagery freshness; route alerts through an independently running monitoring service so a stopped database schedule cannot hide its own failure. Test deleted/disabled schedule detection, scheduler dispatch outage, crash after claim/upload, future retry across drain, late enqueue after drain, backoff expiry, switch-off, simultaneous invocations and budget exhaustion. Recovery recreates a missing registration only through an approved operational repair; it is never an enqueue lifecycle.

## 8. Copernicus Retry-After correction (specified, not implemented)

**[docs]** CDSE Sentinel Hub documents numeric `Retry-After` values in milliseconds.

Narrow change in `_shared/satellite-cdse.ts`, `fetchWithRetry` only:

- numeric header → milliseconds as given (no × 1000);
- HTTP-date header → `date − now`;
- missing/invalid → existing exponential backoff;
- clamp to [250 ms, caller cap]; if wait exceeds the remaining run budget, stop and record `retry_after_until` instead of sleeping.

Automated tests: `"5000"` → 5000 ms; `"0"` → 250 ms floor; HTTP date 30 s ahead → ~30 000 ms; missing header → backoff; `"abc"` → backoff; `"999999999"` → clamped and deferred, not slept.

## 9. Read-only live schema inventory and precise additive delta

**[catalog] 19 Oct 2026:** inspected `information_schema.columns`, `pg_class` ACL/RLS, `pg_constraint`, `pg_indexes`, `pg_policies`, application trigger/function definitions only. Target is the **Portal imagery store** used by `getServiceClient()`, not the shared mobile vineyard database. No application data was queried and no DDL executed. Catalogue results are the basis below; repeat the inventory immediately before any separately approved migration to reject drift rather than use `ADD IF NOT EXISTS` to mask incompatible meanings.

### 9.1 Already present — do not add duplicates or rewrite values

| Existing object | Verified fields/contracts reused |
|---|---|
| `satellite_scenes` | `id, vineyard_id, paddock_id, provider, collection, provider_scene_id, acquired_at, scene_cloud_cover_pct, paddock_valid_coverage_pct, paddock_cloud_cover_pct, spatial_resolution_m, quality_status, processing_status, source_metadata, created_at, updated_at` |
| `satellite_raster_assets` | `id, satellite_scene_id, index_type, storage_path, mime_type, bounds, native_resolution_m, display_resolution_m, minimum_value, maximum_value, colour_scale, processing_version, created_at, asset_type, raster_width, raster_height, data_type, scale_factor, no_data_sentinel, row_orientation, acquisition_date` |
| `satellite_index_summaries` | scene/index/`processing_version`, min/max/mean/median/stddev, p10/p25/p75/p90, valid/no-data counts and timestamps already exist |
| `satellite_paddock_manifest` | provider-check time, latest display/complete scene/date, processing version, missing asset/summary counts and existing package-status check already exist |
| Legacy orchestration | `satellite_processing_jobs`, `satellite_backfill_jobs`, `satellite_backfill_settings`, `satellite_expected_dates`, `satellite_refresh_jobs` remain unchanged; do not reinterpret `auto_backfill` as new-worker opt-in |

Reuse `provider_scene_id` as the scene's provider item identity; **do not add a duplicate `provider_product_id`**. Exact original product mapping and datatake belong to the new acquisition source manifest. Keep existing provider value `CDSE_SENTINEL_HUB`, not a historical rewrite to `copernicus_sh`. Reuse `processing_version` as algorithm/output version, not a competing `algorithm_version`. Existing `scale_factor` describes stored raster encoding, **not source reflectance calibration**. `bounds` is existing display-facing metadata, not the native affine. Native/display resolution fields already exist: their historical values are not corrected in place.

Verified existing uniqueness: scenes `(provider, provider_scene_id, paddock_id)` **and an additional unique index `(vineyard_id,paddock_id,provider,UTC acquisition date)`**; assets `(satellite_scene_id,index_type,asset_type,processing_version)` (two equivalent unique indexes); summaries `(satellite_scene_id,index_type,processing_version)`; manifest `(vineyard_id,paddock_id)`. Existing asset/summary FKs cascade on scene deletion. All nine tables have RLS enabled. Policies observed are service-role ALL policies on eight tables; summaries have no policy. Catalogue ACLs give service role table access; several orchestration/summary/manifest tables also have anon/authenticated table grants, but grants alone do not bypass RLS. No permissions are widened or cleaned up in this revision.

**Publication blockers found in the catalogue:** the UTC-day unique scene index prevents independently publishing multiple same-day passes/products for one paddock/provider. Never overwrite one to represent another, manufacture a provider name, or silently drop this index. The additive foundation can store each in the new acquisition queue, but publication must choose one explicitly identified single product (or approved same-pass mosaic) per day; if independent same-day scene publication is needed, a later separately approved constraint change is required. `refresh_paddock_manifest(uuid)` hard-codes `sentinel2-v3-eleven-layers`, whereas current code writes `sentinel2-v6-native-10m`. Scene/asset/summary triggers call that helper. New-version publication cannot be claimed compatible until a separately reviewed manifest/version-reader change is proven; do not implement it as part of an additive foundation or rewrite historical manifests now.

### 9.2 Truly new columns (nullable; no historical backfill)

- `satellite_scenes.acquisition_id uuid NULL` → new acquisition FK, `ON DELETE RESTRICT`. Other scene provenance resolves through this relation; existing `source_metadata` remains untouched.
- `satellite_raster_assets.provenance jsonb NULL`: object with `schema_version:1`, per-band source IDs/asset identity/checksum, original product mapping, baseline and applied scale/offset/harmonisation, cloud-mask method/native grid, source grids, measurement grid and output grid, resampling and clipping rules, acquisition manifest hash and same-pass proof where authorised. Each grid has CRS, six-term affine convention, dimensions, pixel convention and cell size. Output may differ between analytical and display assets. No redundant dedicated CRS/band/calibration columns competing with this versioned object.
- `satellite_raster_assets.verified_at timestamptz NULL`, `byte_size bigint NULL`, `content_sha256 text NULL`.
- `satellite_index_summaries.analysis_provenance jsonb NULL`: schema version, analytical content hash, source-manifest hash, grid/validity/clipping/statistic estimator identity. This links stats to the precise analytical cells rather than a separate day-window request.

Nullable-only checks for new rows: provenance is object/schema version 1 with required typed keys; size >0 when present, checksum 64 lowercase hex when present; verified rows require checksum/size/provenance; grid affine has six finite numbers and positive dimensions/cell size. New-pipeline writes require full provenance by service-only completion validation; nullable legacy fields stay valid. Do not broaden existing asset/status checks or modify historical row semantics.

### 9.3 Truly new tables and constraints

Names below are absent in the inspected public column catalogue; fresh inspection is mandatory before migration. UUID primary keys unless noted; timestamps are timestamptz. No new FKs into the separate vineyard database: vineyard/paddock UUIDs are externally verified together before enqueue/claim/publication.

| New table | Key data / required constraints |
|---|---|
| `satellite_acquisitions` | `provider, collection, provider_scene_id, acquired_at, source_manifest jsonb, source_manifest_hash, provenance_version=1`; unique `(provider,collection,provider_scene_id,source_manifest_hash)` permits immutable reprocessing identity. Manifest includes original product IDs, datatake, baseline, asset references/checksums, platform, tile CRS/grids. A mosaic has an explicitly authorised source-set identity, not a forged single product ID. |
| `satellite_work_items` | vineyard/paddock, acquisition FK RESTRICT, layer/asset kind, `processing_version`, lane/priority, status, attempts, due time, lease owner/token/expiry/heartbeat, immutable idempotency key UNIQUE, estimated/actual costs, boundary snapshot/hash. Positive lease/attempt checks, enumerated states/layers, due/lease indexes; completion requires current token and matching tenant/acquisition. |
| `satellite_provider_budget` | provider + accounting-period key UNIQUE, daily/monthly/request/CPU/transfer/storage ceilings, reserved/used amounts; nonnegative counters, atomic reservations, hard approved spend ceiling. |
| `satellite_provider_throttle` | provider PK, tokens/capacity/refill time, `next_allowed_at`, `retry_after_until`, concurrency limit; nonnegative tokens, positive capacity. |
| `satellite_ingestion_control` | scope (`global/provider/vineyard`) + scope key UNIQUE, enabled=false, reason/changed_by/changed_at; explicit vineyard opt-in here, missing scope treated disabled. |
| `satellite_freshness` | vineyard/paddock/provider/processing-version UNIQUE, successful provider check plus newest discovered/usable/verified-complete acquisition FKs/timestamps, measured quality/source hash. Separate from legacy manifest: authoritative new-worker readiness only; no silent replacement of legacy page values. |
| `satellite_ingest_runs` | run ID, scheduler correlation ID, job kind/provider/vineyard scope, start/end/status/reason, no-op flag, units/calls/cost/error totals and heartbeat; no credentials or request auth headers. Append-only log with approved retention. |

### 9.4 New functions, privileges, versioning and rollback (proposal only)

Absent queue-helper names in catalogue: proposed service-only `claim_work_item`, `heartbeat_work_item`, `complete_work_item`, `reserve_budget`, `record_provider_backoff`, `refresh_freshness`; additionally `release_work_item` and `finish_ingest_run` need existence/signature inventory before migration. Claim/heartbeat/complete/release take a UUID lease token; complete checks immutable source proof, tenant binding, approved version, content verification and fenced state in one transaction. Budget reservations and throttle updates are transactional. Full signatures/bodies and constraint SQL must be reviewed at Gate B; this is an exact object delta, **not executable migration approval**.

For every new public table: `CREATE TABLE` → `GRANT ALL TO service_role` → enable RLS → service-role-only ALL policy in the same migration. No anon/authenticated grants or policies in the foundation: existing authenticated admin-facing edge functions enforce the unchanged gate and return scoped data. New SECURITY DEFINER helpers have fixed `search_path`, fully qualified references, EXECUTE revoked from PUBLIC/anon/authenticated and granted to service_role only, no dynamic SQL or caller-supplied tenant bypass. Existing table grants, RLS, storage policies, auth helpers and trigger bodies remain unchanged. Test unauthenticated/member denial and authorised machine access in isolation, not by seeding production.

New output gets a new `processing_version`; old objects, rows, values and version keys never overwritten. Nullable new fields leave legacy content unverified, not presumed provenance-correct. Publish through existing scene/asset tables only after the day-uniqueness and manifest/reader blockers are explicitly settled. Do not mutate existing legacy scene rows merely to attach a new acquisition.

Rollback first disables the new worker/provider/vineyard controls, then uses separately authorised schedule removal and disables new entry points; preserve audit/provenance/new imagery for investigation and revert readers to legacy versions. An unused isolated foundation may drop only its newly introduced FK/checks/columns/functions/tables in dependency order, after proving no consumers/data; populated production additions are retained, never destructive `CASCADE`. Restore any later-approved manifest/constraint changes from separately captured definitions, not guessed SQL. No rollback step was run.

## 10. Monitoring and alerts

Scheduler delivery/receipt/idle health is monitored separately under section 7.1; freshness alone never proves scheduling works.

Diagnostics data (UI unchanged now): the four freshness values, queue depth per lane, budget used, 429 counts, dead items. Alerts: no successful discovery in 24 h; fresh lane non-empty > 24 h; usable acquisition exists but not complete within 48 h; provider paused > 6 h; budget > 90%.

## 11. Read-only provider benchmark and acceptance

Scope: 60–90 days for Stockman's Ridge (plus other test vineyards for non-Australian or cloudier cases). **Catalogue/metadata only** until separately approved — no pixel requests, no worker activation.

Catalogue-only stage measures discovery, band metadata availability, advertised resolution and estimated costs. Scene-cloud metadata is not paddock-local quality. The remaining pixel/worker metrics below are deferred to Gates V/D, not claimed measurable from metadata:

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

## 12. Ordered implementation plan — separate explicit approvals

**Gate A = document/architecture direction only.** It authorises no code, SQL/DDL, data migration/backfill, cron registration, paid provider/pixel calls, function deployment, release or production enablement. This message does **not** approve Gate A. Each stage requires a separately scoped explicit approval; a prior gate is not blanket approval for later stages.

1. **Gate A — architecture decision:** review this revision, costs and outstanding blockers; approve direction or request revision. Work remains document-only.
2. **Gate R — small Retry-After correction:** separately approve only the narrow source fix and offline tests in section 8, no deployment/provider calls. Report evidence before any release approval.
3. **Gate B — additive schema:** approve exact reviewed migration/rollback/privilege tests after refreshed catalogue inventory. Foundation disabled, no cron, no historical backfill. Separately approve manifest/reader or day-uniqueness changes if needed; these are not implicitly additive.
4. **Gate P — offline processor/adapter implementation:** approve code and golden/grid/source-contract fixture tests only. No provider calls or deployed ingestion. Report numeric differences honestly; native-grid correction is not unconditional historical parity.
5. **Gate C — metadata benchmark:** explicit approval for bounded catalogue/metadata requests, providers/window/quotas and any costs. No imagery, workers or backfill. Pixel-dependent metrics are not measurable in this stage.
6. **Gate V — exact-source/pixel validation:** separately approve a small bounded set of product/band reads and source-lock experiments with a spend cap; prove grid, masks, provenance, parity and reader compatibility. Failure to prove exact source blocks activation. No unattended worker yet; no production history rewriting.
7. **Gate D — controlled worker trial:** explicit deployment/schedule/provider-call approval for Stockman's Ridge only, disabled foundation first then explicitly enabled 14-day field trial. Register the continuous 10-minute worker and separate daily discovery only here, after machine-auth, schedule health, recovery, spend caps and publication blockers pass. No wider opt-in.
8. **Gate E — optional provider change:** separately approve Earth Search/DEA adapter, metadata then bounded pixel comparison, corrections/attribution and labelled series break. No provider switch implied by Gate A or trial.
9. **Gate F — production enablement:** explicit production release and vineyard rollout approval after trial evidence, cross-reader compatibility, alerting and monthly budgets. Retire browser-driven backfill only in an approved code stage; page layout/diagnostics remain unchanged for this revision.

### Gate A decision checklist

- [ ] Accept daily discovery plus a permanently registered **144/day** worker timing/cost trade-off, pending measured costs and later activation approval.
- [ ] Accept native tile measurement vs display separation, 20 m aggregation/mask rules and truthful versioned provenance.
- [ ] Accept exact-source proof as a hard activation blocker, with individual-product band fallback if Sentinel Hub cannot prove selection.
- [ ] Accept catalogue-based additive delta; acknowledge UTC-day uniqueness and manifest-version publication blockers need separate decisions.
- [ ] Accept golden-fixture tolerances and documented/versioned differences, with **no parity claim before approved tests run**.
- [ ] Supply/approve later quotas, fresh/backfill reservation, history depth, per-vineyard monthly spend ceiling and alert owner; unknown figures are not assumed approved defaults.
- [ ] Confirm every later code/schema/request/trial/deployment stage needs its own explicit approval.

## 13. Outstanding unknowns and activation blockers

- Exact CDSE selection-to-original-product mapping, Statistics provenance capabilities and repeatability across calls; no runtime exact-source proof yet.
- Native grid/header availability through the selected Copernicus mechanism; individual-band decoding, mask/harmonisation and baseline handling have not been exercised.
- UTC-day unique scene index, manifest hard-coded version and analytical-reader projection assumptions block safe new-version publication until reviewed and tested.
- CDSE account PU/request quotas, overage pricing, monthly spend ceilings, idle **144/day** invocation/database costs, worker transfer/storage costs and fresh/backfill budget values remain unapproved/unverified. Illustrative ~248 units and 70% reservation are planning examples, not measured billing or approved limits.
- Sentinel-2C availability/latency, provider catalogue mapping, DEA fair-use/attribution, NBART vs L2A comparability and any future provider-series break remain benchmark questions.
- Worker CPU/memory/runtime and decoding size limits; robust machine-auth/Vault path; independently monitored scheduler delivery/receipt; canonical geometry read and boundary-hash fencing remain untested.
- Multi-tile same-pass permission, cross-zone native representation, seam/overlap policy, valid-coverage thresholds and numerical estimator agreement require explicit acceptance.
- No golden, provider, scheduler, pixel, deployment or field-trial tests were executed in this document-only revision. Current code, imagery, permissions, schedules and Crop Health layout/diagnostics are unchanged.
