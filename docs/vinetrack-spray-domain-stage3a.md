# Stage 3A — Spray Job domain, calculation contract and persistence mapping

Production VineTrack project: `tbafuqwruefgkbyxrxyb` (iOS Supabase client,
`@/integrations/ios-supabase/client`). No schema changes, no migrations, no new
RPCs were made in this stage. Nothing in the Spray Job UI was rebuilt — this is
the domain + calculation layer the Stage 3B wizard will consume.

## Modules

| Module | Responsibility |
|---|---|
| `src/lib/sprayApplicationDomain.ts` | Canonical vocabulary (application mode, targets, head target, carrier basis, product rate basis), the `SprayApplication` model, legacy job/template adapter, resistance `CandidateApplication` seam. |
| `src/lib/sprayApplicationGeometry.ts` | Per-block geometry with explicit precedence + provenance, treated-area rules, aggregation to application geometry. |
| `src/lib/sprayCalculation.ts` | The single pipeline: geometry → carrier → products → tanks, with diagnostics and `canRecord`. |
| `src/lib/sprayChemicalSnapshot.ts` | `chemicalSnapshot` builder/reader per the sql/194 contract §8, capture lifecycle, immutability. |
| `src/lib/sprayRecordAttribution.ts` | Reads `spray_records.application_blocks` (legacy `block_ids` fallback); never re-derives history. |

Tests: `src/test/sprayCalculation.test.ts` (34 cases — geometry precedence,
banded vs foliar treated area, L/ha ↔ L/100 m equivalence, concentration
factor, per-100 L products, tank conservation, legacy adapters, snapshot shape
and immutability, block attribution).

## Calculation pipeline

```text
row geometry ──▶ application geometry ──▶ carrier volume ──▶ product quantities ──▶ tanks
```

Each stage is pure; a missing input yields `null` plus a diagnostic code rather
than a fabricated number. `canRecord` is false while any `error` diagnostic
remains.

Key rules implemented:

- Geometry precedence: operator override → mapped rows → gross area × row
  spacing → incomplete. Provenance is returned for area, spacing and row length.
- Treated area: foliar/spreader = gross area; banded = row length × total
  treated band width (fallback gross × band ÷ spacing). Band width is the total
  treated width per row, not per side.
- Carrier: `litres_per_hectare` × relevant hectares, or
  `litres_per_100m` × (canonical row length ÷ 100). The equivalent other basis
  is derived from row spacing when known.
- Concentration factor = dilute L/100 m ÷ applied L/100 m (values below 1 raise
  a warning).
- Product bases stay independent of the carrier basis: `per_hectare` (gross),
  `per_treated_hectare`, `per_100_litres`.
- Rates are operator-entered; label ranges only validate (`in_range`,
  `below_range`, `above_range`, `unable_to_validate`) and are never auto-filled.
- Tanks: full loads + one partial; per-product apportionment is pro-rata and the
  final tank absorbs rounding so totals are conserved exactly. Rounding happens
  only at the display edge (`roundLitres`, `roundProduct`, `roundArea`).
- Spreader applications are valid with no carrier volume.

## Persistence mapping (read model)

| Domain field | Column |
|---|---|
| `mode` | `spray_jobs.application_mode` (legacy `operation_type` fallback) |
| `targets` | `spray_jobs.targets text[]` (legacy `target` free text preserved as `legacyTargetText`) |
| `headTarget` | `spray_jobs.spray_head_target` |
| `carrier.basis` | `spray_jobs.carrier_volume_basis` (vineyard default: `vineyards.spray_carrier_volume_basis`) |
| `carrier.litresPerHectare` | `spray_jobs.spray_rate_per_ha` |
| `carrier.appliedLitresPer100m` / `diluteLitresPer100m` | same-named columns |
| `carrier.concentrationFactor` | `spray_jobs.concentration_factor` |
| `totalTreatedBandWidthMetres` | `spray_jobs.band_width_total_metres` |
| geometry override | `gross_area_ha`, `row_spacing_metres`, `canonical_row_length_metres` |
| geometry outcome | `geometry_source`, `geometry_quality`, `treated_area_ha` |
| `blockIds` | `spray_job_paddocks.paddock_id` |
| products | `spray_jobs.chemical_lines` JSONB (`savedChemicalId`, `rate`, `unit`, `rate_basis`) |
| recorded blocks | `spray_records.application_blocks` (legacy `block_ids`) |
| recorded carrier | `spray_records.carrier_litres_per_hectare`, `dilute_litres_per_100m` |
| line snapshot | `chemicalSnapshot` inside `spray_records.tanks` / `spray_jobs.tanks` |

Templates carry settings only — blocks and therefore geometry are resolved per
job, and the adapter records a compatibility note when a template is loaded.

## Backward compatibility

Legacy jobs and templates keep loading through `fromLegacySprayJob`, which:

- infers nothing it cannot prove — unknown modes/bases/targets become `null`
  plus a human-readable `compatibilityNotes` entry;
- maps only an explicit, conservative list of free-text targets;
- preserves legacy chemical group strings verbatim on the line;
- never rewrites historical rows.

## Open items to confirm with Rork before Stage 3B writes

1. Raw spelling of `geometry_source` values — the portal currently uses
   `operator_override`, `mapped_rows`, `derived_area_spacing`, `incomplete`
   (check constraint values could not be read from the client).
2. Whether a banded L/ha carrier rate applies to treated or gross hectares.
   Implemented as treated hectares, switchable via `bandedCarrierArea`.
3. Whether `concentration_factor` is authored or always derived from the two
   L/100 m values. The portal derives it whenever both values are present.
