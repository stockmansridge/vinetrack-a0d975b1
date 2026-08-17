# Stage 3A — Spray Job domain, calculation contract and persistence mapping

Production VineTrack project: `tbafuqwruefgkbyxrxyb` (iOS Supabase client,
`@/integrations/ios-supabase/client`). No schema changes, no migrations, no new
RPCs. Nothing in the Spray Job UI has been rebuilt — this is the domain +
calculation layer the Stage 3B wizard will consume.

The vocabulary and semantics below are the **Rork-verified contract** (SQL
191–195, iOS and Android). There are no outstanding items to confirm.

## Modules

| Module | Responsibility |
|---|---|
| `src/lib/sprayApplicationDomain.ts` | Canonical vocabulary (application mode, operation type, targets, head target, carrier basis, product rate basis), the `SprayApplication` model, legacy job/template adapter, resistance `CandidateApplication` seam. |
| `src/lib/sprayApplicationGeometry.ts` | Per-block geometry with explicit precedence + provenance, treated-area rules and method, aggregation to application geometry. |
| `src/lib/sprayCalculation.ts` | The single pipeline: geometry → carrier → products → tanks, with diagnostics and `canRecord`. |
| `src/lib/sprayChemicalSnapshot.ts` | `chemicalSnapshot` builder/reader per the sql/194 contract §8, capture lifecycle, immutability. |
| `src/lib/sprayRecordAttribution.ts` | Reads `spray_records.application_blocks` (legacy `block_ids` fallback); never re-derives history. |

Tests: `src/test/sprayCalculation.test.ts` (59 cases, including the mandatory
Rork parity fixtures).

## Canonical enums

| Concept | Raw values |
|---|---|
| `application_mode` | `whole_block`, `banded` |
| `operation_type` (retained) | Foliar Spray, Spreader, Banded Spray → domain `foliar`, `spreader`, `banded` |
| `geometry_source` | `operator_override`, `mapped_rows`, `derived_from_area_and_spacing`, `unavailable` |
| `geometry_source` (deprecated) | `stored_row_length` — SQL 191 only; read-tolerated as operator override, **never written** |
| geometry quality | `authoritative`, `derived`, `incomplete` |
| treated-area method | `canonical_row_length`, `area_and_spacing_fallback`, `whole_block`, `unavailable` |
| `spray_head_target` | `full_canopy`, `bunch_line`, `leaf_zone` (**foliar only**, else NULL) |
| `carrier_volume_basis` | `l_per_ha`, `l_per_100m` (vineyard preference may also be `either`) |
| product `rate_basis` | `whole_block_area`, `treated_area`, `per_100_litres`, `per_100_metres` |
| `targets` | `powdery_mildew`, `downy_mildew`, `botrytis`, `weeds`, `nutrition_biostimulant`, `other` |

Operation-type mapping: **Foliar Spray → `whole_block`**, **Spreader →
`whole_block`**, **Banded Spray → `banded`**. `operation_type` remains persisted
separately because it still distinguishes Foliar from Spreader for product/UI
semantics and Resistance Check context — `whole_block` is not a synonym for
Foliar.

`targets = NULL` means *never recorded / unknown*; an explicitly empty array is
a different fact and the adapter preserves the distinction.

## Calculation pipeline

```text
row geometry ──▶ application geometry ──▶ carrier volume ──▶ product quantities ──▶ tanks
```

Each stage is pure; a missing input yields `null` plus a diagnostic code rather
than a fabricated number. `canRecord` is false while any `error` diagnostic
remains.

### Geometry

- Precedence: operator override → mapped rows → gross area × row spacing →
  unavailable. Provenance is returned for area, spacing and row length.
- Treated area, per block first:
  - whole_block: gross area (`whole_block`).
  - banded, canonical row length known: `row length × total band width ÷ 10,000`
    (`canonical_row_length`).
  - banded, row length itself derived: `gross ha × band ÷ row spacing`
    (`area_and_spacing_fallback`).
- Band width is the **total** treated width per row, not per side.
- If any selected block cannot resolve its treated area, the aggregate treated
  area is `null` — never a partial sum. `incomplete_block_geometry` is raised.
- Mixed treated-area methods across banded blocks aggregate to
  `area_and_spacing_fallback` (mobile behaviour).

### Carrier

- `l_per_ha`: `total = rate × GROSS hectares` — **including banded
  applications**. Treated hectares never scale the carrier.
- `l_per_100m`: `total = canonical row length ÷ 100 × applied L/100 m`. If the
  canonical row length is unresolved, the carrier stays incomplete; there is no
  fallback to L/ha.
- Equivalence: `L/ha = L/100 m × 100 ÷ row spacing`. Derived only when the
  selected blocks share the same spacing within a 1 mm tolerance; otherwise the
  derived L/ha is `null` and spacings are never averaged.
- Concentration factor: `CF = max(1, dilute ÷ applied)`. It is supported in both
  L/100 m mode and L/ha mode (using the dilute L/ha reference). The result can
  never fall below 1.
- **CF authority:** while authoring, CF is derived from the current inputs. When
  a job/record already carries a persisted `concentration_factor`, that stored
  value is authoritative history and is returned as-is
  (`concentrationFactorSource = "persisted"`). History is never rewritten.

### Products

Product bases are independent of the carrier basis and of each other:

| Basis | Multiplier |
|---|---|
| `whole_block_area` | gross hectares |
| `treated_area` | treated hectares |
| `per_100_litres` | total carrier litres ÷ 100 |
| `per_100_metres` | canonical row length ÷ 100 |

`per_100_metres` is independent of carrier basis, treated area and gross area.
If the canonical row length is unavailable the line returns an incomplete
calculation (`per_100m_needs_row_length`) — no substitute basis is used.

An absent legacy `rate_basis` means `whole_block_area`. Legacy per-hectare
products are never reinterpreted as `treated_area`.

Rates are operator-entered; label ranges only validate (`in_range`,
`below_range`, `above_range`, `unable_to_validate`) and are never auto-filled.

### Tanks

Full loads plus one partial; per-product apportionment is pro-rata and the final
tank absorbs rounding so totals are conserved exactly. Rounding happens only at
the display edge (`roundLitres`, `roundProduct`, `roundArea`).

## Persistence mapping (read model)

| Domain field | Column |
|---|---|
| `mode` | `spray_jobs.application_mode` |
| `operationType` | `spray_jobs.operation_type` (retained, not collapsed) |
| `targets` | `spray_jobs.targets text[]` (legacy `target` free text preserved as `legacyTargetText`) |
| `headTarget` | `spray_jobs.spray_head_target` (NULL for banded/spreader) |
| `carrier.basis` | `spray_jobs.carrier_volume_basis` (vineyard default: `vineyards.spray_carrier_volume_basis`, may be `either`) |
| total carrier litres | `spray_jobs.water_volume` |
| `carrier.litresPerHectare` | `spray_jobs.spray_rate_per_ha` |
| `carrier.appliedLitresPer100m` / `diluteLitresPer100m` | same-named columns |
| `carrier.concentrationFactor` | `spray_jobs.concentration_factor` |
| `totalTreatedBandWidthMetres` | `spray_jobs.band_width_total_metres` |
| geometry override | `gross_area_ha`, `row_spacing_metres`, `canonical_row_length_metres` |
| geometry outcome | `geometry_source`, `geometry_quality`, `treated_area_ha` |
| `blockIds` | `spray_job_paddocks.paddock_id` |
| products | `spray_jobs.chemical_lines` JSONB (`savedChemicalId`, `rate`, `unit`, `rate_basis`) |
| recorded blocks | `spray_records.application_blocks` (legacy `block_ids`) |
| line snapshot | `chemicalSnapshot` inside `spray_records.tanks` |

There is no `total_carrier_litres` and no `carrier_litres_per_hectare` on
`spray_jobs`; the planned-job schema uses `water_volume` and
`spray_rate_per_ha`.

## Chemical snapshot lifecycle

- Planning / product selection does **not** freeze chemistry.
  `spray_jobs.chemical_lines` are configuration references only (saved chemical
  ID, name, rate, unit, rate basis).
- The snapshot is captured at **record creation** (`shouldCaptureSnapshot` is
  true only for `recording` / `recorded`).
- Existing snapshots are immutable — `preserveExistingSnapshot` always keeps the
  stored one.
- Capture matching order (mobile parity): saved chemical ID → registration
  identity key → exact unique product name → unresolved. No fuzzy matching.

## Templates

Lovable spray_jobs templates remain **block-free**: template → new job → choose
blocks → calculate fresh geometry. Mobile has a separate `spray_records`-based
template system that can retain block identity; the two systems are distinct and
are not merged.

## Backward compatibility

Legacy jobs and templates keep loading through `fromLegacySprayJob`, which:

- maps Foliar/Spreader → `whole_block` and Banded → `banded`, keeping the
  operation type;
- defaults an absent product rate basis to `whole_block_area`;
- drops a foliar head target when the operation type is banded or spreader;
- maps only an explicit, conservative list of free-text targets, and never
  fabricates targets, head targets, row geometry or structured chemistry;
- preserves legacy chemical group strings verbatim on the line;
- never rewrites historical rows.

## Database changes

NONE. The production schema already supports Stage 3B.
