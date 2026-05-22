# Spray Program Import — Proposed Contract (for Rork sign-off)

**Status:** DRAFT — awaiting Rork confirmation. No Lovable import code will
ship until the items in §7 are answered.

**Scope:** A Lovable-side `.xlsx` import that creates **planned `spray_jobs`
rows** (draft) for a yearly spray program. This is explicitly *not* a
`spray_records` (Task Log) import — that path stays on the existing
Rork CSV (`SprayProgramCSVService`) and belongs on the Spray Records page.

---

## 1. Lovable observations to confirm

We could not find `spray_jobs` / `spray_job_paddocks` referenced anywhere
in the Rork iOS repo (`grep -r "spray_jobs"` returns nothing in `ios/` and
`docs/`). Lovable currently treats `spray_jobs` as the canonical planned-job
table and writes to it via `src/lib/sprayJobsQuery.ts`. **Before we build
import**, Rork please confirm:

- iOS does read `spray_jobs` rows (even if it does not write them) — yes/no.
- If iOS does not read them today, is there a different planned-program
  table/model we should target instead?
- If `spray_jobs` is the correct shared table, please confirm the column
  contract in §3 below matches what iOS expects.

---

## 2. Proposed Excel workbook

File name: `VineTrack_Spray_Program_Template_<VineyardName>_<Year>.xlsx`

### Tab 1 — `Spray Program` (the only imported sheet)

One row = one planned spray job.

| Column | Required | Maps to `spray_jobs` | Notes |
|---|---|---|---|
| Job Name | yes | `name` | free text |
| Planned Date | yes | `planned_date` (ISO date) | Excel date cell; we normalise to `YYYY-MM-DD` |
| Status | no — defaults `draft` | `status` | Allowed values §4 |
| Operation Type | yes | `operation_type` | Allowed values §4 |
| Target | no | `target` | free text (e.g. "Powdery mildew") |
| Growth Stage | no | `growth_stage_code` | E-L codes (`EL12` etc.) — matches Rork |
| Blocks | yes | `spray_job_paddocks.paddock_id[]` | semicolon-separated block names, looked up against `paddocks.name` for the vineyard |
| Water Rate L/ha | no | `water_volume` | numeric |
| Equipment | no | `equipment_id` | matched by name against `spray_equipment` |
| Operator | no | `operator_user_id` | matched by display_name/email via `get_vineyard_team_members` |
| Concentration Factor | no | `concentration_factor` | numeric (default 1) |
| Row Spacing m | no | `row_spacing_metres` | numeric |
| Canopy Size | no | `vsp_canopy_size` | enum (small/medium/large) |
| Canopy Density | no | `vsp_canopy_density` | enum (sparse/medium/dense) |
| Product 1..6 Name | one of 1..6 required | `chemical_lines[i].name` | matched against `saved_chemicals.name` for the vineyard |
| Product 1..6 Rate | with name | `chemical_lines[i].rate` | numeric |
| Product 1..6 Unit | with name | `chemical_lines[i].unit` | Allowed: `Litres`, `mL`, `Kg`, `g` (iOS raw enum) |
| Product 1..6 Rate Basis | with name | `chemical_lines[i].rate_basis` | `per_hectare` or `per_100_litres` |
| Notes | no | `notes` | free text |
| Make Template (Yes/No) | no — default No | `is_template` | If Yes, row is imported as a reusable template (no planned_date required) |

Support **6 chemicals per job** to stay consistent with Rork's `maxChemicals
= 6` (used in `SprayProgramCSVService`).

### Tab 2 — `Blocks` (reference, read-only)
Pre-populated from the vineyard's current paddocks.
Columns: `Block Name | Block ID | Variety | Area ha`.

### Tab 3 — `Chemicals` (reference, read-only)
Pre-populated from `saved_chemicals` for the vineyard.
Columns: `Product Name | Saved Chemical ID | Default Rate | Unit | Rate Basis | Restrictions`.

### Tab 4 — `Equipment` (reference, read-only)
Pre-populated from `spray_equipment`. Columns: `Equipment Name | Equipment ID | Type`.

### Tab 5 — `Allowed Values` (reference, drives dropdown validation)
Lists: Status, Operation Type, Units, Rate Basis, Yes/No.

---

## 3. Proposed `spray_jobs` row written per imported Excel row

```jsonc
{
  "vineyard_id": "<current vineyard>",
  "name": "Spring Powdery 1",
  "is_template": false,
  "planned_date": "2026-09-15",
  "status": "draft",
  "operation_type": "Foliar Spray",
  "target": "Powdery mildew",
  "growth_stage_code": "EL15",
  "water_volume": 600,
  "equipment_id": "<uuid|null>",
  "operator_user_id": "<uuid|null>",
  "concentration_factor": 1.0,
  "row_spacing_metres": 3.0,
  "vsp_canopy_size": "medium",
  "vsp_canopy_density": "medium",
  "notes": "...",
  "chemical_lines": [
    {
      "name": "Mancozeb 750 WG",
      "savedChemicalId": "<uuid|null>",
      "rate": 2.0,
      "unit": "Kg/ha",          // long iOS-compat form, set by normaliseChemicalLinesForIOS
      "rate_basis": "per_hectare",
      "ratePerHa": 2.0,
      "ratePer100L": null,
      "product_type": "solid"
    }
  ]
}
```

Plus, for each row, `spray_job_paddocks` link rows:
```jsonc
{ "spray_job_id": "<new>", "paddock_id": "<resolved-uuid>" }
```

All writes go through the **existing** helpers in
`src/lib/sprayJobsQuery.ts` (`createSprayJob` → `spray_jobs` insert +
`replaceSprayJobPaddocks`). No new direct table writes are introduced by
import. Chemical-line normalisation reuses `normaliseChemicalLinesForIOS`
so the legacy `ratePerHa` / `ratePer100L` / `unit` enum fields iOS reads
are populated identically to a UI-created job.

---

## 4. Allowed enum values (need Rork confirmation)

| Field | Proposed allowed values | Source |
|---|---|---|
| `status` | `draft` only on import (v1) | Lovable proposal |
| `operation_type` | `Foliar Spray`, `Banded Spray`, `Spreader` | Rork `OperationType` raw enum in `SprayProgramCSVService` |
| chemical `unit` | `Litres`, `mL`, `Kg`, `g` | Rork `ChemicalUnit` raw enum |
| `rate_basis` | `per_hectare`, `per_100_litres` | Lovable `rateBasis.ts` (already iOS-compat) |
| `growth_stage_code` | E-L code free text (`EL00`..`EL47`) | Rork template comment |

---

## 5. Validation rules (per row)

Hard errors (row blocked):
- Job Name empty
- Planned Date missing/unparseable (unless Make Template = Yes)
- Operation Type missing or not in allowed list
- Blocks: at least one, and every name must resolve to a paddock in this vineyard
- For every product row: Rate must be numeric > 0, Unit in allowed list, Rate Basis in allowed list
- A row must have at least one product

Warnings (row imports, flagged in preview):
- Product name not found in `saved_chemicals` (treated as **unmatched**, not auto-created — see §6)
- Equipment name not found
- Operator name not found
- Planned Date in the past
- Duplicate (same Job Name + Planned Date + Blocks set) of an existing draft

Always:
- Blank rows ignored.
- Row numbers in errors are Excel row numbers (header = row 1, data starts row 2 — or row 3 if we keep Rork's "row 1 description" convention; please advise).

---

## 6. Missing chemicals — proposed behaviour

**v1 default:** Flag as warning, import the line with `savedChemicalId =
null` and the typed name/rate/unit preserved. **Do not auto-create**
`saved_chemicals` rows. Match the existing Lovable behaviour for manually
created jobs.

Optional toggle in the import dialog (off by default):
- "Create missing chemicals in saved chemicals" → on confirm, insert
  minimal `saved_chemicals` rows (name + unit + default rate) before
  linking. Owner/manager only.

Please confirm Rork is happy with both branches.

---

## 7. Open questions for Rork

1. Is `spray_jobs` the correct shared table for planned program rows that
   iOS will display? If not, what is?
2. Confirm `operation_type` values are exactly `Foliar Spray | Banded
   Spray | Spreader` for `spray_jobs` (same as `spray_records`)?
3. Confirm `status` enum values — is `draft` correct, and what are the
   other allowed values (`scheduled`, `in_progress`, `completed`,
   `cancelled`, …)? Imported rows will always be `draft` in v1.
4. Confirm `chemical_lines` JSON shape in §3 — particularly that iOS
   reads both the long-form `unit` ("Kg/ha") **and** the legacy
   `ratePerHa` / `ratePer100L` numerics, the way Lovable already writes
   them via `normaliseChemicalLinesForIOS`.
5. Should imported templates (`Make Template = Yes`) be supported in v1,
   or restrict v1 to planned jobs only?
6. Is a server-side batch RPC (`import_spray_program_jobs(p_vineyard_id,
   p_rows jsonb)`) preferred over N client-side inserts, to keep the
   import atomic and enforce RLS once? If yes, Rork to provide the RPC
   signature and we'll call it from Lovable instead of looping
   `createSprayJob`.
7. Confirm that no `spray_records` rows must be created by this import
   under any circumstance (we will not — but want this stated for the
   record).
8. Block matching: match on `paddocks.name` case-insensitive, scoped to
   `vineyard_id`. Any objection?
9. Equipment matching: match on `spray_equipment.name` scoped to
   `vineyard_id`. Confirm field name.
10. Operator matching: match on display_name → full_name → email via
    `get_vineyard_team_members`. Confirm acceptable.

---

## 8. v1 guardrails (Lovable will commit to these)

- Creates **draft `spray_jobs`** only. Never `spray_records`.
- Never overwrites existing jobs. "Replace year" workflow deferred.
- Missing chemicals are flagged, not silently created (toggle off by
  default).
- Templates importable only if §7-5 is approved; otherwise blocked.
- Import is reviewable in a preview table; final "Import N jobs" button
  is disabled while any hard error remains.
- Per-row error report downloadable as `.csv`.

---

## 9. What we are *not* doing

- Not changing the Spray Records (Task Log) import — Rork's existing
  CSV continues to own that page.
- Not introducing any new Lovable-only enum, status, or JSON shape.
- Not writing any RPC or migration on the iOS Supabase project until
  Rork confirms §7-6.
