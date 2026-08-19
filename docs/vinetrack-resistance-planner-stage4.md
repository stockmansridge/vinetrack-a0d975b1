# VineTrack Resistance Planner — Stage 4 (Portal)

Tool ID: `resistance_planner` · Route: `/tools/resistance-planner`
Database changes: **NONE**. SQL 196 (`public.resistance_plans`) and SQL 198
(revision concurrency) already provide the full backend contract.

## 1. SQL 196 mapping (`src/lib/resistancePlanContract.ts`)

| Column | Portal field | Notes |
| --- | --- | --- |
| `id` | `id` | Stable plan ID. Empty string = unsaved draft. |
| `vineyard_id` | `vineyardId` | |
| `season_id` | `seasonId` | Rork season string, e.g. `2026/27`. Not a calendar year. |
| `disease` | `disease` | Engine disease ID (`powdery_mildew`, `downy_mildew`). |
| `jurisdiction` | `jurisdiction` | Derived from the vineyard; not user-switchable. |
| `crop` | `crop` | Defaults to `grape`. |
| `block_ids` | `blockIds` | Stable block UUIDs, never names. |
| `positions` | `positions` | jsonb array, see §3. |
| `notes` | `notes` | |
| `ruleset_id` / `ruleset_version` | `rulesetId` / `rulesetVersion` | Provenance of the last evaluation/save. |
| `created_at` / `updated_at` / `created_by` / `updated_by` | mirrored | Read-only. |
| `deleted_at` | `deletedAt` | Soft delete (§5). |
| `client_updated_at` | written on every save | Sync semantics only — does not decide staleness. |
| `server_revision` | `serverRevision` | Retained exactly as loaded (SQL 198). |

`planWritePayload()` writes the mutable columns only. It never writes
`server_revision`, `base_revision`, or any derived resistance value.

## 2. SQL 198 writes (`src/lib/resistancePlanQuery.ts`)

Create, save and archive all go through the shared `revisionWrite` helper from
Stage 2A:

- insert → `baseRevision: null`;
- update → `base_revision = <server_revision exactly as loaded>`;
- returned representation is always requested, so the client picks up the new
  authoritative revision;
- a genuine `PT409` / `REVISION_CONFLICT` throws `RevisionConflictError`, which
  the editor renders as an explicit "changed elsewhere" panel with
  *Reload the server version* / *Keep my edits*. There is no last-write-wins
  path and no silent retry.

## 3. Position JSON contract

```jsonc
{
  "id": "stable-position-id",   // never regenerated on edit or reorder
  "sequence": 1,                 // persisted order — chronology is saved, not rendered
  "groups": ["3"],              // group-first; ["3","11"] is a COMBINATION, not one group
  "savedChemicalId": null,       // optional; product selection is secondary
  "productName": null,
  "target": null,
  "growthStage": null,
  "notes": null
}
```

Reading is tolerant: camelCase and snake_case keys are both accepted, the
original key style is remembered, and **unknown server fields are preserved
verbatim** through an edit/save round trip for forward compatibility.

## 4. Plan lifecycle and multi-plan behaviour

- The landing screen is a **plan list**. SQL 196 permits several plans for the
  same vineyard + season + disease, so the portal never resolves a plan by
  "first match on season + disease". Every operation after selection uses the
  stable plan ID.
- Filters exist for season and disease; soft-deleted plans are excluded.
- **Duplicate** copies intent only: no plan ID, fresh stable position IDs, no
  revision metadata.

## 5. Delete / archive

Soft delete via the shared `soft_delete_resistance_plan` RPC (mirrored by
`restore_resistance_plan`). No hard deletes — the mobile contract expects
soft-deleted records to remain.

## 6. Actual-history projection

Reused verbatim from Stage 3C (`fetchResistanceHistory` +
`resistanceEventSource`). There is no second implementation.

- Block attribution comes from `spray_records.application_blocks` (SQL 195). A
  spray recorded against A and C contributes to both blocks independently;
  `application_blocks = NULL` means *attribution unknown* and is surfaced as
  history uncertainty, never inferred from current block names or spray-job
  paddocks.
- Chemistry comes from the immutable `chemicalSnapshot` on the record. Current
  Saved Chemical chemistry is never substituted; an absent snapshot degrades
  evidence quality.
- `targets = NULL` means *target not recorded*, not *no target*.
- One spray = one chronological event, however many product lines it carries.
- Each selected block is evaluated independently; the plan headline uses
  worst-case aggregation while block-level findings stay visible.
- If the history query **fails**, the planner reports *Unable to fully assess*.
  An empty result from a failed read is never treated as a clean season.

## 7. Planned positions vs actual applications

`src/lib/resistance/resistancePlanEvents.ts` projects positions into engine
events with `kind: "planned"` and application ID `plan-position:<positionId>`.
One event is emitted per position **per block**. Planned events are spaced
nominally (14 days) from an anchor at the later of now and the last actual
application, clamped inside the season. Saving a plan never creates an
application: planned and actual remain distinct in the engine, the timeline and
the database.

## 8. Ruleset identity and drift

The ruleset ID/version in force at the last save is persisted. On open, the
stored provenance is compared with the active engine ruleset; drift shows
"Resistance strategy rules have been updated since this plan was saved. Review
the current assessment." The stored provenance is only rewritten when the user
saves.

Opening a plan **always** re-evaluates against current spray records, so
applications made after the plan was written are assessed.

## 9. No verdict persistence

Consistent with Stage 3C: no verdict, score, findings or evaluation blob is
written to SQL 196. Results are recomputed. The Strategy Exceeded /
Unable-to-fully-assess acknowledgement before save is UI-only.

## 10. Jurisdiction

The plan's jurisdiction comes from the vineyard. Where no published strategy
exists (currently anything other than AU grape powdery/downy), the planner shows
"Resistance planning strategy not yet supported for this jurisdiction" and does
not run Australian CropLife rules. Foreign-registered Saved Chemicals keep their
chemistry but carry the jurisdiction notice from the Chemical Jurisdiction
contract; their label is never implied to be authoritative.

## 11. Interoperability

Portal reads mobile-created plans and writes the same shape back; there are no
portal-only required fields. Round-trip fidelity (plan ID, position IDs, order,
block IDs, ruleset provenance, unknown fields) is pinned by
`src/test/resistancePlanner.test.ts`.

## 12. Deferred

- Plan → Proposed Spray → Actual Spray linkage (next stage). Stable position
  IDs are preserved now so linkage can be added without a migration.
- Restoring archived plans has an RPC wired in the query layer but no UI yet.
- Planned position dates are nominal spacing, not user-set calendar dates:
  SQL 196 positions carry no date field and none was invented.
