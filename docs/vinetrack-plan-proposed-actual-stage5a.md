# VineTrack Stage 5A — Plan → Proposed → Actual Linkage Contract Audit

Status: **audit and design only**. No schema was created, no linkage was
implemented, and no Stage 5B work was started.

Sources of truth for this audit: the shared VineTrack project
(`tbafuqwruefgkbyxrxyb`) as consumed by the portal query layer
(`src/lib/sprayJobsQuery.ts`, `src/lib/sprayRecordsQuery.ts`,
`src/lib/resistancePlanContract.ts`), `docs/supabase-schema.md`,
`docs/vinetrack-spray-domain-stage3a.md` and the Stage 4 planner contract.
The PostgREST OpenAPI root is service-role gated, so column facts below come
from the verified column probes already captured in code and docs.

---

## 1. Current schema findings

### `resistance_plans` (SQL 196, SQL 198)

```
id, vineyard_id, season_id, disease, jurisdiction, crop, block_ids,
positions (jsonb), notes, ruleset_id, ruleset_version,
created_at, updated_at, created_by, updated_by, deleted_at,
client_updated_at, server_revision, base_revision
```

Positions live **inside** the `positions` jsonb array; each element carries a
stable `id`, a `sequence`, and a `groups` array. There is no `resistance_plan_positions`
table, and no column anywhere referencing a spray job or spray record.

### `spray_jobs`

```
id, vineyard_id, name, is_template, planned_date, status, operation_type,
target, targets, chemical_lines (jsonb), water_volume, spray_rate_per_ha,
equipment_id, tractor_id, operator_user_id, notes, growth_stage_code,
vsp_canopy_size, vsp_canopy_density, row_spacing_metres, concentration_factor,
application_mode, spray_head_target, carrier_volume_basis,
applied_litres_per_100m, dilute_litres_per_100m, band_width_total_metres,
gross_area_ha, treated_area_ha, canonical_row_length_metres,
geometry_source, geometry_quality, revision, created_at, updated_at, deleted_at
```

`status` ∈ `draft | scheduled | in_progress | completed | cancelled`.
**No plan reference, no position reference, no generic source/origin field.**

### `spray_job_paddocks`

Join table only: `spray_job_id`, `paddock_id`. No per-block execution state.

### `spray_records`

```
id, vineyard_id, spray_job_id, trip_id, date, start_time, end_time,
temperature, wind_speed, wind_direction, humidity, spray_reference, notes,
number_of_fans_jets, average_speed, equipment_type, tractor, tractor_gear,
machine_id, tractor_id, spray_equipment_id, is_template, operation_type,
targets, application_blocks (jsonb), block_ids, tanks (jsonb),
created_at, updated_at, deleted_at
```

`tanks[].chemicals[].chemicalSnapshot` is the immutable chemistry evidence
(Stage 3A). `application_blocks` (SQL 195) is the frozen per-block attribution.
**No plan reference and no position reference.**

### Existing linkage opportunities

| Link | Field | Verdict |
| --- | --- | --- |
| Job → Record | `spray_records.spray_job_id` | **Exists and is already used** by the portal (`fetchLinkedSprayRecords`, `linkSprayRecord`, `unlinkSprayRecord`). One job may have several records (split dates/tanks). |
| Job → Blocks | `spray_job_paddocks` | Exists. |
| Record → Blocks | `application_blocks` (frozen), legacy `block_ids` | Exists. |
| Plan → Job | — | **Missing.** |
| Plan → Record | — | **Missing** (only derivable transitively once Plan → Job exists). |
| Position → anything | — | **Missing.** Positions are jsonb elements with no referencing surface. |

---

## 2. Stable identities

| Entity | Stable ID | Notes |
| --- | --- | --- |
| Plan | `resistance_plans.id` (uuid) | Persistent, soft-deleted not removed. |
| Position | `positions[].id` inside the plan jsonb | Stable across edits and reordering (Stage 4 guarantees this; `duplicatePlan` mints new ones). Unique per plan, **not** globally unique unless generated as a UUID — mobile-written IDs are opaque strings. |
| Spray Job | `spray_jobs.id` (uuid) | |
| Spray Record | `spray_records.id` (uuid) | The application/record identity used by the resistance history projector. |

Linkage must be anchored on `positions[].id` — never on `sequence`, timeline
index or display order, all of which change on reorder. Chemistry match
(planned FRAC 3 vs actual FRAC 3) may power a *suggested* match in the UI but
can never be authoritative: a season can hold several FRAC 3 positions across
different blocks and dates.

---

## 3. Recommended authoritative relationship

**One direction only, held on the executing record, not in the plan.**

```
spray_jobs.resistance_plan_id        uuid  null  -- FK → resistance_plans(id)
spray_jobs.resistance_position_id    text  null  -- positions[].id, opaque string
```

Everything else is derived:

- Position → Job: `select … from spray_jobs where resistance_position_id = $1`.
- Position → Record: join `spray_records.spray_job_id → spray_jobs.id` (the
  existing link) and read the position reference off the job.
- Plan progress: group jobs/records by `resistance_position_id`.

Deliberately **not** proposed: `positions[].jobId`, `positions[].recordId`,
`spray_records.resistance_position_id`. Each of those is an independently
editable second copy of the same fact, and two copies eventually disagree.
A record inherits its plan provenance from its job; if a record is later
relinked to another job (`linkSprayRecord`), provenance follows correctly and
automatically.

Both fields are nullable and additive: every existing job, record and plan stays
valid, and no mobile build breaks by not knowing them.

---

## 4. SQL 198 / concurrency implications

This is the strongest argument for keeping linkage **out of the plan jsonb**.

If completing a spray wrote into `resistance_plans.positions`, every operator
completing a job would take a `server_revision` bump on the plan. A manager
editing the plan in the portal would then hit a revision conflict caused by
field work they never touched — the exact scenario Stage 4's conflict UI exists
to prevent, not to generate.

With the linkage on `spray_jobs`:

- plan edits stay under SQL 198 with the manager as the only writer;
- job/record writes take the job's own `revision`;
- the two never contend.

---

## 5. Multi-block and multi-execution analysis

| Case | Modelled by current schema? | With the proposed contract |
| --- | --- | --- |
| A. One position → one job → one record | Job→Record: yes. Position→Job: no. | Yes. |
| B. One position → job split across two dates | Yes — `spray_records.spray_job_id` already supports many records per job. | Yes, unchanged. |
| C. One position over blocks A+B → separate job per block | Job blocks via `spray_job_paddocks`; record blocks via `application_blocks`. | Yes — **one position must be allowed to link to multiple jobs**. Coverage is then computed by set difference of planned blocks vs the union of executed blocks. |
| D. Job cancelled, replacement created | `status = cancelled` exists. | Yes — both jobs reference the position; cancelled jobs are excluded from progress. |
| E. One spray satisfies two planned positions | Not modelled. | **Not modelled** by the minimal contract (a job carries one position reference). Deliberate: a many-to-many join table is the alternative, and it should only be added if the field evidence shows it is real. Recommendation: defer; do not fake it with inference. |

**One position → multiple executions: RECOMMENDED (required for cases B, C, D).**
No hidden splitting semantics: the planner shows planned-block coverage
explicitly ("2 of 3 planned blocks covered") rather than silently declaring a
position complete. A dedicated position/block execution layer is **not**
recommended yet — the block sets on the job and the frozen `application_blocks`
on the record already carry the information needed to compute coverage.

---

## 6. Plan → Proposed Spray (design)

From a planner position: **Create Spray Job**. The wizard opens prefilled with:

| Prefill | Flows through today's schema? |
| --- | --- |
| Blocks (plan blocks ∩ selectable) | Yes — `spray_job_paddocks`. |
| Target/disease | Yes — `spray_jobs.target` / `targets`. |
| Intended group/combination | **Presentation only** — no group column on the job; it is carried by the chosen chemical's snapshot chemistry. |
| Optional chemical from the position | Yes — `chemical_lines`. |
| Plan ID + position ID | **No** — requires the two additive fields above. |

So: **Plan → Proposed Spray is PARTIAL today.** The operational content
prefills fine; the provenance does not persist.

Rules that hold regardless:

- The job, not the plan, is the truth of the proposed operation. Changing the
  chemical, blocks, carrier, quantities or target is allowed and expected; the
  planner later reports it as a deviation, it does not block it.
- The Stage 3C Live Resistance Check re-evaluates the actual proposed job
  against current history. A plan that was clean in September is not assumed
  clean in November.

---

## 7. Proposed → Actual traceability

`spray_records.spray_job_id` already exists and is already written by the
portal's link/unlink flow, so **Proposed → Actual is traceable today: YES**.

Caveat, stated explicitly: whether every mobile completion path sets
`spray_job_id` automatically is a Rork question, not a portal one. The portal
provides manual link/unlink for records that arrive unlinked, which implies the
mobile flow does not always populate it. Rork should confirm and, if needed,
make job-originated completions always carry `spray_job_id`.

Immutability is unchanged: the plan never mutates a spray record, and no
`chemicalSnapshot` is ever rewritten. Linkage is provenance, not content.

---

## 8. Deviation model

Implemented as a pure, dormant helper: `src/lib/resistance/planDeviation.ts`
(tests: `src/test/planDeviation.test.ts`). It touches no database and is wired
to no UI.

`comparePlanExecution(planned, executed)` returns one of:
`exact_match`, `superset_match`, `partial_combination`, `different_group`,
`chemistry_unknown` — plus planned-block coverage, unplanned blocks, and target
mismatch/unknown flags, and a plain sentence.

It is **not** a score and **not** a compliance verdict. Plan deviation ≠
strategy exceeded: a different group may be entirely compliant, and an on-plan
group may still breach the strategy. The Resistance Engine keeps sole ownership
of compliance; this layer only answers whether execution matched intent.

Derived position status (`planned | proposed | completed | deviated |
cancelled`) is computed from links, never persisted. With today's schema every
position necessarily reads `planned`.

---

## 9. UI design (not built)

**Planner position row** — future actions: *Create Spray Job*, *Open linked
Spray Job*, *Open completed Spray Record*; status chip from the derived model
above, with a coverage line for multi-block positions. None of this ships until
the linkage exists; no dormant fake links, no placeholder chips.

**Spray Job wizard** — a "From Resistance Plan" context card showing plan,
position, intended group/combination and the plan's block context, with the Live
Resistance Check showing planned intent alongside the current proposed
assessment.

**Completed Spray Record** — read-only provenance: "Created from Spray Job
[job]" (available today) and "Originated from Resistance Plan [plan] — Position
[x]" (once the job carries the reference). Read-only; no historical mutation.

---

## 10. Cross-platform and offline

- iOS/Android/portal all read the same two additive job columns; nothing
  portal-only is proposed.
- Plan created on iOS → job created on portal → completed on Android → plan
  reopened on iOS: works, because provenance lives on the job row and the
  position ID is the plan's own stable ID.
- Offline: jobs already use client-generated UUIDs, and position IDs are minted
  when the plan is authored, so a device offline can reference a position it
  already holds. Requirement for Rork: `resistance_position_id` must be a plain
  text reference with **no FK into the jsonb** (impossible anyway) and **no
  server-side validation that the position still exists** — a position deleted
  after a job was created must not block the job's sync. The planner shows such
  a job as "linked to a removed position".
- `resistance_plan_id` may be a real FK to `resistance_plans(id)`; plans are
  soft-deleted, so the reference stays resolvable.

---

## 11. API / webhook / export impact (future, not implemented)

Once the fields exist, the shared identifiers should surface in:

- REST: `GET /spray-jobs` (+ detail) — `resistance_plan_id`,
  `resistance_position_id`; `GET /spray-records` — the same values echoed as
  derived read-only provenance.
- Webhooks: `spray_job.created` / `spray_job.updated` / spray-record completion
  payloads.
- Exports: spray job and spray record CSV/PDF provenance column; a future
  resistance plan progress export.
- A future `GET /resistance-plans/{id}/progress` returning per-position
  derived status is the natural read model — computed, never stored.

---

## 12. Future parity fixtures (to be written after the contract lands)

Plan position → proposed job; proposed job → completed record; exact planned
group match; different-but-compliant group; strategy-exceeded actual on an
on-plan position; multi-block partial execution; cancelled job with replacement;
offline-created linkage syncing late; plan edited after the job was proposed
(position ID survives); historical `chemicalSnapshot` unchanged after linkage.
None of these can be written before the fields exist — schema-dependent tests
are deliberately deferred.

---

## 13. Deferred / open questions for Rork

1. Does every mobile completion path already set `spray_records.spray_job_id`?
2. Case E (one spray satisfying two positions) — real in the field, or theory?
3. Should a position carry an explicit "skipped" intent, or is absence of any
   linked job sufficient?
