# Portal-only contour-first block creation, saving and activation

**Status: D0 design complete; NOT implemented or released.** 18 October 2026.

This document selects **private staging** and Portal-exclusive contour authoring. It supersedes the public pending-block alternative and mobile-editor workstreams in earlier contour-first proposals. The existing draft pilot remains review-only. All schema, RPC, trigger, validator and UI names below are proposals unless explicitly identified as existing. This document contains no executable SQL.

## 1. Scope, evidence and non-negotiable boundaries

- All drawing, generation, editing, imports, new-block authoring, revisions, review, activation and revert UI belong in **Lovable Portal**. No iOS/Android contour editor or generator. Rork's separate draft PR #3 covers a mobile notice; a notice alone does not satisfy operational safety.
- Keep the existing Straight creation branch byte-for-byte unchanged, including step validations, generated rows, insert fields and save permissions. Route Contour into a separate branch, not a refactor of Straight.
- Pilot authorisation is signed-in `auth.uid()` + active System Admin + membership/ownership of the selected, nondeleted vineyard, **checked server-side on every call**. Ordinary operational roles retain their existing rights; no permission widening is proposed.
- New stage/activation capabilities default OFF. Client visibility is not authorisation; an authoritative server gate also rejects activation while disabled or prerequisites are unmet. No flag values change today.
- Existing live-block draft APIs, foreign keys, tombstones, historical operational records, calculations and production data remain unchanged today. No app-facing secrets or client bypass flags.

### Evidence classification

**User-supplied read-only production facts, not re-queried for this document:** 873 nonarchived blocks, 86 with `rows=[]`; public block SELECT allows members/System Admins; owner/manager/supervisor/operator INSERT/UPDATE rights; row identity guard, pin geometry-history snapshot and yield-refresh triggers exist; PostGIS is absent; mobile full-row upserts retain straight endpoints, ignore unknown path geometry, and can replay offline; mobile GPS/aisle matching uses endpoints. Empty rows therefore **never mean pending**. Public pending blocks cannot be securely hidden using Portal filters.

**Repository-confirmed:** references in sections 10–11. The exact deployed definitions/names/order of all live identity/history/yield triggers and remote geometry-dependent RPCs still require an authorised read-only catalogue inventory before implementation. Repository migration headers are not evidence that production lacks a trigger confirmed by the user.

**Not verified here:** mobile PR contents, mobile source/build behavior, database validator availability beyond the supplied facts, concurrent database execution, browser flows, or deployed grants. D4 requires actual verification, not these design assertions.

## 2. State machine: private is not operational

```text
Unsaved Portal form (no public block, no saved stage)
   | Save private stage: one stable future paddock UUID
   v
editing -- Save Draft --> editing (revision increases; still private)
   | server validation/review against exact immutable revision
   v
ready -- any edit/boundary change --> editing (readiness invalidated)
   | explicit confirmation + approved activation transaction
   v
activated (terminal stage receipt; real public contour block exists)

editing / ready -- confirmed discard --> discarded (terminal tombstone)

Activated public geometry v1 -- reviewed revision/revert --> v2, v3...
                             (new immutable versions, no history deletion)
```

- `editing`, `ready`, `discarded` have **zero public paddocks**, zero operational/sync/report exposure. A staged UUID is a reservation, not a block.
- `ready` means a particular revision passed trusted geometric review; it does **not** mean operational activation is permitted. Mobile/consumer gates can keep Activate disabled indefinitely.
- A stage edit after readiness clears its readiness token. A discarded stage/future UUID cannot be resurrected; a new attempt receives new IDs.
- `activated` is immutable and cannot be saved/discarded as a stage. Later contour revisions are new private change proposals against the active version, with an explicit reviewed activation transaction.
- Existing straight blocks remain real/operational even with a saved contour draft. Label: **“Contour draft - not operational”**. Draft numbering does not renumber public rows.
- Existing real rowless blocks keep existing semantics; do not relabel, migrate, or include them in staging automatically.

## 3. Proposed private storage and integrity contract

Use the existing `vt_contour_private` security boundary. Private tables have RLS enabled, **no app-role direct table grants and no permissive policies**; audited, narrowly executable functions own access. Public stage RPCs follow the existing SECURITY INVOKER wrapper/private SECURITY DEFINER pattern, with pinned search paths and qualified object access. Owners of protected writer functions must not be app roles.

### 3.1 Stage aggregate: one unified CAS revision

**`vt_contour_private.block_stages`** (new):

| Columns | Meaning/constraints |
| --- | --- |
| `stage_id` UUID PK; `future_paddock_id` UUID NOT NULL UNIQUE | Client preassigns once per attempt; server reserves atomically. No FK to public paddocks before activation. Reject collisions with any existing public block or other reservation, across vineyards. |
| `vineyard_id`, `created_by`, `updated_by` UUID NOT NULL | Tenant immutable; derive actor from `auth.uid()`. Validate live vineyard/membership, never accept a supplied actor as authority. |
| `status` | Exactly `editing`, `ready`, `activated`, `discarded`; terminal states never reopen. |
| `revision` bigint NOT NULL | Initial accepted create = 1; every accepted save/review/discard/activation increments once; positive and monotonic, never reset. Expected revision mandatory. |
| `block_fields` JSON object; `boundary` JSON array | Allowlisted ordinary block metadata: name/area inputs, varieties, vine/length overrides, trellis, irrigation settings and other current form fields. Define exact whitelist against NewPaddock insert before D1; reject embedded IDs/rows/privileges/mode flags not in contract. Structural validation allows incomplete mapper rows, not malformed metadata/boundary. |
| `draft_id` UUID UNIQUE; `draft_schema_version` = 1; `draft_payload` JSON object | Existing v1 payload, `paddockId=future_paddock_id`, matching `vineyardId/draftId`. New contour-first `canonicalRowId` must be null. Draft/part/group IDs remain stable through save/retry. |
| `content_fingerprint`, `boundary_fingerprint`, `mapping_fingerprint` | Server-derived versioned canonical digest (recommend SHA-256). Content includes all fields and ordered arrays; mapping includes row order, identity, number, parts, coordinates, canonical links and group spacing. No client hash alone is trusted. |
| `ready_revision`, `validation_id`, `activation_plan_id` nullable | Present only for ready aggregate; bind exact revision/fingerprints/validator policy/import acknowledgements. Any edit invalidates. |
| `last_client_operation_id`, `created_at`, `updated_at`, terminal actor/time | Auditable save receipt pointer; authoritative server timestamps. `activated_paddock_id` must equal future ID; terminal data retained under reviewed retention policy. |

Unified revision covers form, boundary **and** draft: a second tab cannot overwrite one while saving the other. No separate silently merged row revision. Server canonicalises JSON object keys but preserves physical row/part/group array order; property order alone is not a change.

**`stage_operations`**: `operation_id` UUID PK (globally unique); `stage_id`, tenant, actor, action (`create/save/review/discard/activate`), request digest including expected revision, accepted revision, immutable response/receipt, server time. Same UUID + same identity/action/request returns original response; any reuse with changed scope/body returns `operation_id_reused`. Receipts remain after discard. Validate current authorisation before replay; receipts cannot become a data leak.

**`stage_tombstones`**: `stage_id` PK, unique future UUID and draft UUID, final revision, discard operation/actor/time. Retain permanent anti-resurrection identity even if draft content is later purged by an approved retention process. No cascade from public block deletion may erase activation history or tombstones.

### 3.2 Readiness and reserved activation plans

**`validation_receipts`**: immutable `validation_id` PK, stage/proposal ID, exact input revision/digests, validator engine+policy version, coordinate reference/precision, server result/errors, size/complexity budget, import exception acknowledgement, actor/time. Browser result is advisory only.

**`activation_plans` / `activation_plan_rows`**: immutable plan ID, exact stage revision/digest, row-order list, draft-row-ID → reserved physical-row-ID map, stable endpoint IDs, number, group/part identities, geometry/spacing digest and validation receipt. Unique `(plan_id,draft_row_id)` and `(plan_id,physical_row_id)`; reserve physical row UUIDs globally against other plans/operational rows. Repeated review of unchanged input reuses the plan; a changed revision requires a new reviewed plan. Plan is written before activation so a lost-response retry cannot remint row IDs. Never infer canonical identity from row number.

### 3.3 Public metadata and protected operational paths (D2 proposals)

- Add explicit `public.paddocks.row_geometry_mode`: `straight` default for existing and unchanged straight inserts, `contour` only via approved activation. Do not derive mode from row count, draft existence or arbitrary JSON keys.
- Add current `geometry_version` pointer. The **version identity and version contents are immutable**; only an approved activation/revision/revert can advance the pointer. Capture a baseline version for straight geometry before an existing-block conversion without rewriting original history.
- Protected **`block_geometry_versions`**: version UUID PK, `(paddock_id,version_number)` UNIQUE; vineyard, mode, ordered row identities/numbers, boundary, immutable ordinary geometry/override inputs, digests, measured metrics, validation policy, activation event, timestamp. Composite tenant/block keys prevent cross-vineyard joins.
- Protected **`row_geometry_paths`**: PK `(paddock_id,geometry_version,row_id)`; vineyard, physical number, group, ordered multipart path JSON with stable part IDs, per-part measured length and total measured length, spacing/projection metadata. Version/block FK; uniqueness of number within version; globally reserved physical IDs may recur **only within the same block's versions**. One physical row identity/number across all disconnected parts.
- Protected **`activation_events`**: event/operation UUID, actor/tenant, source stage or live draft identity+revision, plan/mapping, before/after version IDs and snapshots, request/receipt digest, validation ID, reason, timestamp. New-block before snapshot explicitly records “block absent”, not fictitious straight rows. Append-only; a revert creates another event.
- Public `paddocks.rows` contains stable physical UUID, physical number, stable legacy endpoint objects for decoding, and preserved allowed ordinary row fields. First/last path endpoint are **decoding compatibility only**: the chord between them is never an operational contour path or measured contour length. Authoritative paths stay private; an authorised read-only projection RPC returns the current or historical version and complete ordered parts/metrics to consumers. Missing/denied/version-mismatched projection fails closed; no endpoint fallback.

## 4. New stage-only APIs and recovery

All inputs below are typed contracts to implement later, not SQL. All mutations lock the stage row, recheck authorisation/scope/status, validate input then apply CAS. RPC errors use stable machine codes and nonrevealing messages for denied tenants. Responses echo actor scope, stage/future/draft IDs, revision, fingerprints, status and operation receipt where applicable.

| Proposed RPC | Inputs | Output / behavior |
| --- | --- | --- |
| `create_contour_block_stage` | stage/future/draft UUIDs, vineyard ID, client operation UUID, initial allowlisted fields/boundary/v1 draft | Complete aggregate at revision 1 plus receipt/replayed. Reserving and creating are atomic; no public insert. |
| `get_contour_block_stage` | stage ID, expected vineyard | Authoritative aggregate, current revision, latest receipt and readiness; tombstone for discarded authorised stage. Missing/denied does not disclose another tenant. Optional operation ID recovers a lost response using the immutable operation receipt. |
| `save_contour_block_stage` | stage ID, expected revision, expected draft ID, client operation UUID, complete fields/boundary/draft aggregate | New editing revision and receipt; exact request replay returns original ack. No merge; clears readiness. |
| `discard_contour_block_stage` | stage ID, expected revision/draft ID, operation UUID | Terminal revision/tombstone receipt. Same operation replay is idempotent; already-discarded same identity returns its receipt without touching a replacement. Activated is rejected. |
| `review_contour_block_stage` | stage ID, expected revision, boundary/mapping fingerprints, operation UUID, explicit import acknowledgements | Trusted validation errors, or ready aggregate with next revision, validation/plan IDs and reserved rows. Ready receipt binds the resulting revision. This is not activation. |
| `activate_contour_block_stage` | stage ID, expected ready revision, expected boundary/mapping fingerprints, plan/validation IDs, activation operation UUID, explicit confirmation | Atomic public block+version/path/event creation; terminal stage revision, stable paddock/version IDs and immutable activation receipt. |
| `get_contour_geometry_projection` | vineyard, paddock ID, requested version (or current) | Authorised complete true multipart paths, measured/override metrics and capabilities; never drafts, never anonymous access. |

**Recovery rules:** retry an uncertain request with the *same* operation UUID and unchanged body; do not allocate a new stage/future/row ID. Mark Saved only after the acknowledgement matches our operation and a scoped readback confirms exact identity/revision/content. If a later revision exists, retain our receipt but display “Another tab changed this stage; your edits are kept”, not its payload as our save. Get-by-operation recovers activation after lost connection; then read the activated block/version and terminal stage. No optimistic navigation to a public block before confirmation.

**Error codes:** `not_authorised`, `scope_changed`, `invalid_stage`, `invalid_payload`, `stale_revision`, `draft_identity_mismatch`, `boundary_changed`, `mapping_changed`, `operation_id_reused`, `stage_discarded`, `stage_activated`, `id_collision`, `validation_failed`, `validator_unavailable`, `complexity_limit`, `import_ack_required`, `not_ready`, `activation_disabled`, `consumer_not_safe`, `geometry_version_conflict`, `canonical_mapping_conflict`, `historical_reference_conflict`, `contour_geometry_locked`. Network uncertainty is a client recovery state, not proof of rollback. Domain errors include actionable fields without exposing another tenant.

Existing `get/save/discard_contour_row_mapping_draft` remain unchanged: their private `drafts.paddock_id` FK requires a real public block. A staging UUID **cannot** call them. Reuse payload checks/client interaction helpers via a separate stage adapter, not by relaxing the FK or the live-block authoriser.

## 5. Portal flow, permissions and local-edit safety

```text
New Block
  Straight (default) -> today's complete flow and identical insert
  Contour (pilot) -> Details -> Boundary -> ordinary metadata:
                    varieties / vines / trellis / irrigation
                 -> Save private stage -> full-screen mapper
                 -> Save Draft -> Review readiness -> confirmed Activate
```

No artificial straight rows, no “temporary” public rowless block. Manual vine/area/length fields use existing form rules, not new contour estimates during staging. Stage drafts may remain incomplete and savable; activation requires valid complete mapped geometry. A private stages list is separate from public Blocks, Dashboard, tasks, reports and mobile sync pools.

| Screen/state | Required copy/actions |
| --- | --- |
| Unreleased Contour creation | Choice disabled: “Private contour-first saving is not available yet. Straight block setup is unchanged.” Do not silently save straight rows for a Contour choice. |
| Save stage | “Save private stage”; “This block is not operational and is not available on phones or in reports.” |
| Mapper | “Contour draft - not operational”; Save Draft, Export backup, explicit Discard. No implicit activation on save/navigation. |
| Review | “Review readiness”; show saved revision, boundary/mapping digests, physical row order/numbers, multipart lengths, override effects, group spacing, import exception, validation issues and capability blockers. |
| Ready but gated | Activate disabled: “Activation is unavailable until server validation and phone/operation safety checks are verified. Your draft is saved.” Name the unmet prerequisite. |
| Activate | Explicit “Activate contour rows”; confirmation names block, vineyard, exact revision, resulting physical rows/version, limitations and consumer safety. A changed revision invalidates confirmation. |
| Active setup | “Operational rows: Contour · version …”; Save Boundary/Save Rows locked: “Contour geometry is protected. Create a contour revision in the Portal.” Safe metadata editing stays available. |
| Existing straight block draft | Separate “Operational rows: Straight” and “Contour draft - not operational”; warning that ordinary straight saves regenerate public geometry but do not change the draft. No auto-conversion. |

Key working copies by authenticated user + vineyard + stage/live-block + draft ID; reset mounted scope on account/vineyard changes, ignore late responses from prior scope, and never save into a newly selected vineyard. Before switching, offer keep-in-tab/export/discard for unsaved edits; backups include scope, future UUID, draft and revision. Restoring into the same stage preserves IDs only after authoritative permission/readback checks; copying to a different attempt regenerates all staged IDs and clears canonical links. An account change clears accessible in-memory copies without sending them under the new account. Export before sign-out is explicit; do not use shared localStorage or auto-upload stale backups. A tab crash/unexported browser closure is not durable storage and must be disclosed.

Stale/failed saves never replace working edits, silently clear links or discard local state. Discard requires confirmation and CAS; tombstoned stale tabs cannot resurrect a stage. A saved stage can be resumed only after live authorisation; no offline activation. Browser unload/navigation guards remain best-effort, backed by same-ID retries and exports.

## 6. Activation transaction and write protection

### 6.1 New contour-first INSERT (priority pilot)

1. Reject unless server release gate, user scope and every prerequisite pass. Validate operation replay after current authorisation; same operation returns original receipt.
2. Lock stage, reserved plan and relevant identity reservations in deterministic order. Recheck ready revision, boundary/mapping/content fingerprints, plan/validation IDs and live vineyard. Prevent a simultaneous stage save or public insert of the reserved future UUID.
3. Run trusted deterministic geometry validation on the locked immutable input **inside the transaction**, using pinned validator version/policy and budgets. A preflight receipt is not a substitute. Recheck consumer capabilities/policy and import acknowledgements.
4. Build rows using reserved physical and endpoint IDs and explicit ordered plan. Validate no cross-block/cross-tenant ID collision and legal unique physical numbers. Preserve approved overrides; do not remint on retry.
5. Atomically INSERT public paddock with **preassigned future UUID**, ordinary fields, boundary, public decoding rows, mode `contour` and version pointer; insert immutable protected paths/metrics/version and before/after event; run existing identity, pin snapshot and yield triggers using the reviewed integration order; mark stage activated and write receipt.
6. Any failure rolls everything back, including public row, version, history and receipt. A successful retry after lost response returns the same block/version/row IDs. Reconcile by receipt and authoritative readback.

Do not temporarily commit a public block without paths or mode. Trigger ordering must allow intra-transaction construction without exposing partial state. Exact dependency/deferral mechanics require database-owner review before migration.

### 6.2 Guard contract: no old-client escape hatch

For a contour-active block, reject any attempt to change/delete/renumber/reorder physical rows, endpoints, boundary, mode/version pointer, path geometry, direction, spacing/group projection or geometry-affecting override fields outside the approved versioned writer. This includes full-row mobile upsert, old offline replay, bulk imports, Portal straight saves and service paths used by clients. No client-supplied privilege, bypass boolean, user metadata or loose session setting may authorise it.

Use a dedicated nonlogin owner for tightly scoped activation/revision/revert functions plus a database-owned guard mechanism reviewed against trigger execution semantics; ordinary direct DML roles cannot acquire that authority. If privileged function execution cannot be distinguished safely, restrict contour geometry writes to a locked private command path and reject generic writes. Service/admin maintenance is not an implicit bypass; require an audited reviewed repair path.

Safe nongeometry PATCH may update an allowlist (e.g. name/notes and approved ordinary metadata) **without replacing rows, mode, version or paths**. Submitted full objects with altered geometry fail, even if other fields are safe. Unchanged geometry in a full upsert is not enough to protect newer metadata: separately review metadata conflict behavior; no promise this geometry guard fixes unrelated lost updates. Archive/delete that could orphan history must be separately guarded/reviewed.

Portal locks Save Boundary / Save Rows when active; this is usability, not security. A missing/unknown mode/version/projection must never route to a straight generator for an active contour block. Straight saves on straight blocks remain unchanged.

## 7. Trusted geometry, metrics and override contract

### 7.1 Specific recommended server validator

**Recommendation for database-owner approval:** install reviewed PostGIS in the `extensions` schema, pin supported version and implement a deterministic qualified server validation function callable only through the approved command path. **PostGIS is not installed today; do not install or execute anything as part of D0.** Confirm hosting support, extension privileges, migration rollback, performance and geodesic/local projected metric policy first. If unavailable, obtain a separately reviewed equivalent transactional server validator; browser checks or an unsigned client/external result cannot unlock activation.

Validator must check:

- WGS84 finite/range coordinates, explicit transform/precision policy, valid nonempty block polygon, positive-length parts, stable unique IDs/numbers, ordered multipart topology and no bridge over gaps.
- **Whole segment containment**, not only vertices/midpoints, under a documented reviewed boundary tolerance; reject self-crossing, repeated points, doubling back, intra/inter-row touching, crossing, collinear overlap and collisions using spatial indexing and deterministic tolerances.
- Nonimported groups respect working areas and cut-outs. Imported groups retain the current working-area/cut-out exception, but must still respect block boundary/topology/conflicts; Review explicitly acknowledges that exception and binds acknowledgement to exact revision. Never bypass block containment for imports.
- Resource limits at least as strict as the current draft envelope: 50 groups, 2,000 rows, 200,000 points, 50 parts/row, 2,000 points/part, 4 MB compact payload plus defined canonical server-byte allowance; uploaded file 5 MB is a Portal pre-read limit, not server trust. Define measured worst-case CPU/timeout budgets; fail closed on timeout/complexity, do not return partial success.
- Deterministic measured lengths, group spacing/projection output, engine/policy/precision version and input digests. Validation and insert use identical locked input. Missing validator, capability, stale revision or mismatched digest stops before public writes.

Browser checks remain immediate editing feedback and do not certify activation. Current block-local projection and 10 m/3M-pair cap are not a trusted database spatial guarantee.

### 7.2 Authoritative metrics and unchanged overrides

For physical row `r`, measured length is the sum of successive point-to-point segment lengths **within every part**; never distance between parts. Example: 10 m part + 15 m part separated by 40 m → **25 m**, not 65 m. One physical number/ID, two parts. Store per-part and physical total with metric policy/version.

Keep existing manual block/per-row length and vine-count priority unchanged. Projection exposes **measured** and **effective calculation** lengths separately; manual effective length never reshapes GPS/path geometry. Follow `paddockGeometry.deriveMetrics` and `paddockRowVines` contracts rather than inventing a new precedence: per-row override before row-derived length; singular block total applies under existing helper conditions; positive block vine override before a complete row-effective vine total before caller fallback. Partial row totals are not authoritative. Contour-derived automatic vines may use true measured lengths only after shared rounding/end-post rules are approved. No override is dropped during activation or revision.

**End posts require signoff:** physical topology implies two end posts per disconnected part (two parts → four), not two per logical row. Whether pruning/vine/product formulas currently assume two per row must be inventoried; do not silently change those existing formulas. Block activation where unsupported topology affects required calculations until policy is approved or the consumer is explicitly disabled.

Group spacing may differ. Do not average it into one fabricated `row_width` or use a legacy scalar to calculate treated area, dose or irrigation. Store group/row spacing with provenance; review a per-group effective projection/treated-strip model, including overlaps/boundaries, before allowing these consumers. Polygon area remains its existing separate authoritative area basis. Manual known block settings remain explicit inputs, not proof that variable contour spacing is safe.

### 7.3 Client and mobile safety (no authoring workstream)

Activation **STOP** until each geometry-dependent client/RPC either reads true versioned multipart paths/metrics or reliably blocks that operation on contour blocks. Required matrix: GPS/left-right aisles, row snapping, distance/progress, spray planning and trips, pins/offset location, pruning rows/quarters, irrigation, yield, work tasks and reports. Old chord consumers must not display or record a contour operation as valid.

Minimal mobile work is read-only recognition/projection or a fail-closed compatibility gate, not configuration UI. Offline cached blocks/capture/replay are included: reject geometry changes server-side and reject new geometry-dependent operational writes without an approved version/capability contract. A minimum-version notice alone cannot make an old offline recording safe. If legacy clients cannot safely exclude contour operations, keep Activate disabled even for a Portal admin; draft/ready remains useful privately. All affected operational RPC/direct-write paths need server guards; a Portal flag cannot stop mobile writes.

Historical pins, trips, jobs, pruning and allocations retain original row IDs, numbers, geometry version/snapshot and recorded values. Read historical data against its original version, never current contour geometry. Where old history has only embedded snapshots or row IDs, preserve them as evidence and explicitly resolve version linkage; never backfill by guessing a chord or rewriting frozen actuals.

## 8. Existing-block conversion, revisions and revert

Existing-block conversion is a **separate** RPC/design phase from new-block INSERT. Lock real block/current version plus live draft; snapshot all active geometry/ordered rows/overrides and inventory historical references. Require explicit `canonicalRowId` mapping of all historical linked physical rows **1:1**, preserving IDs and numbers. No inference from row number, array position or proximity. Missing, duplicated, cross-vineyard, deleted, renumbered or unmapped historical IDs hard-stop; an explicit reviewed data-migration plan is required before any exception. New contour-first pilots have priority.

Active contour revisions use private proposal storage with baseline `paddock_id/current_geometry_version`, full immutable draft/fingerprints, the same CAS/tombstone/review semantics and explicit row mapping. They do not overwrite the current path while editing. Review and activation UI remains Portal-only. Exact generic stage-vs-proposal table reuse must preserve a distinct operation kind; do not shoehorn existing live-block draft FK semantics into new staging.

Revert is another approved locked transaction producing a **new audited version**, with before/after snapshots, receipt and reason. Old versions/events remain immutable. Preserve all later linked records and their versions; if identity/number/reference compatibility cannot be proven, return `historical_reference_conflict` and require manual review. Never delete later history or “undo” by restoring a raw public JSON backup. A newly inserted block has no prior public geometry to restore: withdrawing/archiving it requires reviewed safe lifecycle handling, not stage discard or history deletion. Concurrent edit/revert uses current-version CAS; cross-vineyard ID collisions always fail.

## 9. F1 freshness/order hazard before activation

`src/lib/contourRows/blockFreshness.ts:16–26` snapshots row identity, number and coordinates but **sorts by ID** at line 21. It can therefore hide changes to the physical public row array order. Preserve a separate ordered-ID/number fingerprint, including ordered group/row/part sequences for contour review. JSON property order remains irrelevant; physical array order is not.

Required tests before activation: identical rows with array reordered → stale review; identical IDs with renumbered rows → conflict; endpoint/boundary/spacing changed → conflict; object-key reorder alone → unchanged; draft links and local edits survive all rejected saves. Existing F1 pre-save read is not an atomic lock: a real-block boundary can still change between read and current draft save. D2/D3 locked versioned activation closes that specific activation race, not today's draft RPC race.

## 10. Concrete repository touchpoints (future changes only)

| Existing source | Dependency / required boundary |
| --- | --- |
| `src/pages/setup/NewPaddockPage.tsx:17,106–115,245,432` | Uses vineyard `ios-supabase` client; admin contour choice/handoff, public insert and straight-row prerequisite. Verify full insert/step ranges during D1; separate staged branch, preserve Straight. |
| `src/pages/setup/PaddockDetailPage.tsx:291–365` | Preserves row identity/unknown fields during straight regeneration; Save Boundary/Save Rows must lock only for contour-active mode in future. |
| `src/pages/setup/ContourRowMappingPage.tsx:324,359`; `src/lib/contourRows/blockFreshness.ts:16–38,55–61` | Freshness/recheck/scope; order-sensitive version fingerprint needed before activation. |
| `src/lib/contourRows/draftApi.ts:4,60,90–99`; `src/lib/contourRows/workingCopy.ts`; `draft.ts`, `checks.ts`, `geometry.ts`, `rowNumbering.ts`, `importLines.ts`, `rowEdits.ts` | Existing scoped client, payload validation, idempotent save/readback, local-edit/import/numbering semantics; new stage adapter must preserve these without changing live-block APIs. |
| `src/lib/rowLayoutMode.ts`; `src/test/rowLayoutMode.test.ts` | Current operational layout is straight, independent of draft. Future mode must be explicit authoritative metadata, not draft presence. |
| `src/lib/paddockFullBlockBackup.ts:63–116,140,447–449` | UUID regeneration/canonical merge by number is safe for straight backup rules, **not** authority for historical contour conversion. Active contour imports must not call generic geometry patch/reuse inference. |
| `src/test/contourBlockFreshness.test.tsx`, `contourRegenNotice.test.tsx`, `contourRowMapping.test.ts`, `contourRowMappingAccess.test.tsx`, `contourRowMappingWorkingCopy.test.tsx`, `contourRowMappingEditor.test.tsx`, `contourEditorRowActions.test.tsx`, `contourRowNumbering.test.ts`, `newPaddockContourHandoff.test.tsx`, `paddockDetailStraightSaves.test.tsx` | Regression anchors; add staging/transaction/offline/active-mode coverage in later phases, none changed or run for D0. |

### Geometry consumer inventory / activation disposition

This is a concrete bounded source inventory, not a claim that remote SQL or mobile consumers have all been audited. D2 must expand it to a call graph and mark **every** consumer safe or blocked; any unknown required consumer blocks activation.

| Consumer | References | Required contour handling |
| --- | --- | --- |
| Shared Portal row parsing/length/metrics | `src/lib/paddockGeometry.ts:44–96,160–168,233–275` | Explicit length else endpoint chord precedes points; contour mode must use authoritative projection, never chord fallback. Preserve override contracts. |
| Physical vines | `src/lib/paddockRowVines.ts:76–138` | True-path measured input, existing overrides/complete-total priority and rounding; no partial authoritative count. |
| Blocks/Dashboard/setup metrics | `src/pages/Dashboard.tsx:90`, `PaddocksListPage.tsx:82`, `BlockDetailPage.tsx:123`, `src/pages/setup/PaddocksPage.tsx:57–75` | Distinguish polygon-area-only from row-derived figures; missing contour projection must not masquerade as a straight metric. |
| Yield/report/pruning density | `src/lib/yieldReportsQuery.ts:125,142`; `src/pages/tools/YieldCalculatorPage.tsx:93–103,136–147,233–257`; `src/lib/seasonYieldQuery.ts:4,33`; `docs/pruning-yield-settings-contract.md:26–31` | Preserve yield settings and existing historical values; authoritative vines/area, reviewed refresh RPC and trigger behavior. |
| Pruning row/quarter identity and length | `src/lib/pruningCalc.ts:32,63–90`; `src/components/pruning/MultiBlockAllocationEditor.tsx:156–184`; `src/pages/tools/PruningTrackerPage.tsx:898–919` | Uses deriveMetrics/rowLengthMeters and stable IDs; multipart quarter/progress/end-post semantics require signoff or block. |
| Irrigation calculator/infrastructure/history | `src/pages/tools/IrrigationCalculatorPage.tsx:220–291,345`; `src/lib/calculations/irrigation.ts`; `src/lib/irrigationRows.ts:196–197,358–359,444–445,578–586`; `src/pages/tools/IrrigationHistoryPage.tsx:116–117`; `sql/125_irrigation_records.sql:21,200` | Scalar row_width and returned lengths are not variable-spacing authority; validate actual RPC selected/total contour lengths and infrastructure model or block. |
| Spray planning/row recovery/trip/report | `src/lib/sprayRowRecovery.ts`; `src/lib/sprayReportV1.ts:118`; `src/lib/sprayReportExport.ts`; `src/lib/sprayReportPdf.ts`; `sql/235_save_spray_trip_worksheet_v1.sql:13`; `sql/040_paddock_row_length_overrides.sql:33–51` | Exact GPS/aisle/treated-area remote/mobile calculations remain catalogue/source audit blockers; preserve frozen original actuals/path evidence, no chord reconstruction. |
| Work tasks/reports/row snapshots | `src/pages/setup/WorkTasksPage.tsx:134,172–184`; `src/lib/workTasksQuery.ts:759`; `src/lib/yieldReportsQuery.ts` | Located task area path may remain polygon-only; audit piece-rate, rows and operation report totals separately; version-bound snapshot identities. |
| Maps/pins/straight row rendering | `src/components/AppleMapPaddockMap.tsx:53,263`; `src/components/PaddockMap.tsx:95`; `src/components/paddocks/BoundaryDrawMap.tsx:310,521–522,755–756`; `src/components/PinsMap.tsx`; live pin history trigger | Endpoint lines must not render as contour paths. Read true parts or show unavailable. Existing pin history uses original snapshot/version, never remap to current geometry. |
| Other application calculators | `src/pages/tools/FertiliserCalculatorPage.tsx:64` and existing deriveMetrics consumers | Inventory only; no unrelated feature work. Route geometry-dependent inputs to approved projection or block, preserving current straight behavior. |
| SQL yield/pruning/history/geometry | `sql/161_pruning_season_realignment.sql:138–147`; `sql/040_paddock_row_length_overrides.sql:3–18,33–51`; `sql/253_paddock_physical_row_number_guard.sql:24–61` | Retain row references; guard numbers is not spatial validation. Production identity, pin snapshot, yield refresh trigger bodies and all remote RPC consumers still need exact read-only inventory. |

## 11. Database dependency and migration inventory (proposals, no SQL today)

Existing applied draft storage: `sql/contour_row_mapping_round1_applied.sql:40–80` (FK/private tables), `117–130` (live-block authorisation), `140–224` (structural validation), `230–343` (CAS/idempotence/wrappers). Existing verification file: `sql/contour_row_mapping_round1_VERIFY_rollback.sql`. Do not rerun either during this design task. `sql/253_paddock_physical_row_number_guard.sql:24–61` is a source dependency; its NOT APPLIED header does not contradict the supplied live guard facts.

Ordered later migration packages, owned by the authorised shared-database implementer, with separate review/rollback/isolated verification:

1. **M1 private staging:** stage/operation/tombstone aggregate, UUID reservations, indexes/CAS/state constraints, stage-only RPC wrappers/authorisation. Existing drafts/FK untouched. No direct app-table grants; authenticated EXECUTE only on approved wrappers; anonymous denied.
2. **M2 trusted validation:** approved PostGIS installation (if supported) and reviewed deterministic validator/receipts/budgets; no activation permission from browser validation.
3. **M3 operational contract:** explicit mode/default and version pointer, immutable protected versions/paths/plans/events, authorised read-only projection, reservation integrity. Inventory all deployed geometry/identity/history/yield triggers and integrate their order/validation atomically.
4. **M4 guards and consumers:** reject old mobile/Portal geometry upserts; operational write version/capability guards, safe metadata allowlist, archive/history protection; authoritative metrics or fail-closed consumers. Straight role/calculation parity checks required.
5. **M5 activation:** locked idempotent new-block activation; server prerequisites/gates OFF; existing conversion/revision/revert commands separately reviewed, not required for first new-block pilot.

No direct table grant on private paths for mobile reads: use reviewed authorised projection RPC. Public metadata migrations must preserve existing table grants/RLS and normal Straight inserts; they must not expose staging. Catalogue verification must include trigger names/definitions/order, definer ownership/EXECUTE, public Data API grants, archived vineyard behavior, index/FK collision rules, and all operational direct-write routes. No public status filter can substitute for private storage.

## 12. Delivery phases and exit criteria

| Phase | Deliverable/owner boundaries | Exit criteria |
| --- | --- | --- |
| **D0 — design (today)** | This document; optional current-contract cross-link. Portal owns all contour UI; authorised database owner owns later reviewed migrations; Rork only essential mobile read/safety compatibility. | Selected private lifecycle/transactions/geometry safety documented; blockers explicit. No implementation, SQL execution, tests changed, DB writes or release. |
| **D1 — private stage + Portal contour-first save** | M1, separate Portal branch/stage list/mapper adapter/backups; no public rows. | Signed-in stage save/retry/resume/discard/second-tab/tenant tests; zero public records; Straight parity. Save Draft usable, Review/Activate unreleased or disabled. |
| **D2 — trusted validation/mode/paths/guards** | M2–M4; immutable plan/version/projection; full Portal/SQL consumer inventory and minimal mobile safety proof. | Validator fail-closed and deterministic; active write protection/offline gates verified; variable spacing/topology/override/history signoff. No activation until all prerequisites pass. |
| **D3 — Portal Review + explicit Activation** | M5 new-block pilot; full-screen Portal review and confirmation; no mobile authoring. Existing conversion remains separate blocked work unless reviewed. | Single-transaction activation/readback receipts, stable IDs, trusted revalidation, version/history preservation; gates remain off outside authorised isolated pilot. |
| **D4 — signed-in preview / isolated acceptance** | Approved isolated test environment with matching schema, multiple authenticated roles/tabs, mobile offline fixtures/builds. No production data “tests”. | Matrix below passes; actual screenshots/receipts and readbacks recorded; cross-platform safety confirmed, then separate explicit release approval. This document is not deployment approval. |

**Draft mapping complete** = D1 plus draft validation/recovery usability; does not imply real rows. **Operational contours complete** = D2/D3 and every D4 geometry/consumer/mobile/history acceptance gate, with approved release decision. No mobile editor is a completion criterion.

## 13. Acceptance matrix (future tests, NOT RUN today)

| Case | Concrete expected result | Phase |
| --- | --- | --- |
| Second-tab form/boundary/draft conflict | A save at revision R+1 causes tab B expected R to fail; B keeps typed edits/links; no merged/overwritten aggregate. | D1 |
| Same-ID retry/lost response | Create/save/review/activation operation replay returns same stage/future/draft/physical IDs and accepted revision; changed body/scope with same UUID rejected. | D1–D4 |
| Zero public records before activation | Creating/saving/reviewing/discarding stage produces zero paddock, sync, task, yield/report rows; existing 86 rowless blocks unaffected. | D1/D4 |
| Cross-tenant/account denial | Admin outside membership, ordinary member, signed-out, switched account and stale vineyard responses cannot read/write/replay stage or private paths. No direct private grants. | D1–D4 |
| Terminal discard | Old tab/backup/retry cannot resurrect discarded stage/draft/future UUID; readback gives scoped tombstone. | D1 |
| Missing trusted validator | Review cannot certify and Activate cannot write; `validator_unavailable`, zero partial public records. Browser pass does not override. | D2–D4 |
| Boundary/segments/topology/import | Segment exits concave boundary despite in-bound vertices fails; touching/crossing/collisions fail; imported working-area/cut-out exception requires exact-revision acknowledgement, never bypasses block containment. | D2 |
| Multipart metrics | 10 m + 15 m separated by 40 m gives 25 m; one row ID/number, two parts; end-post signoff and group-spacing unsafe calculations blocked. | D2/D4 |
| Row identity/number/order | Duplicate/changed/unmapped canonical IDs and conflicting numbers rejected; reorder-only freshness detected; property-key reorder ignored. Retry does not remint IDs. | D2–D4 |
| Old-mobile full-row upsert/offline replay | Actual old encoded payload cannot change mode, rows/order/endpoints/boundary/spacing/paths or silently record unsafe contour-dependent operations. Visible fail-closed behavior, not chord success. | D2/D4 |
| Safe metadata PATCH | Approved nongeometry field updates succeed under existing roles without clearing/versioning paths; geometry payload rejected server-side regardless of UI. | D2/D4 |
| Concurrent activation/boundary change | Stage/version locks + expected digest permit only one matching activation; conflicting edit fails or invalidates readiness. | D3/D4 |
| Atomic rollback | Force failure in path/history/yield/guard handling: no public block/version/event/terminal success receipt committed; stage remains recoverable. | D3/D4 |
| Historical references/revert | Original pins/trips/jobs/row allocations render using original version; safe revert adds new version; incompatible later links return manual-review conflict, never deletion. | D3/D4; existing conversion later |
| Straight branch parity | Same inputs yield deep-equal existing insert/save payload, steps, calculations and role permissions; normal boundary/rows saves unchanged for straight blocks. | D1–D4 |
| Signed-in/isolated end-to-end | Admin+member creates stage→mapper→save→review→activate→reads true paths/receipt; ordinary users denied pilot; phone/offline geometry operations safe; all required consumers use projection or block. | D4 |

## 14. Remaining blockers and what is not shipped

1. **D1 storage blocker:** stage-only private schema/RPCs do not exist. Existing draft FK/API cannot save a private preassigned future block. Exact ordinary field whitelist and retention/backups contract need database/Portal review.
2. **Activation blocker:** PostGIS absent; no trusted spatial validator. Obtain approved transactional solution and tested deterministic size/topology/containment policy.
3. **Activation blocker:** immutable paths/mode/version/projection, reserved IDs and atomic trigger integration/guards are not implemented. Exact live identity/pin snapshot/yield trigger and remote RPC inventory remains outstanding.
4. **Activation blocker:** old mobile/offline geometry consumers can interpret chords. Read true paths or safely block every relevant operation and replay path; a notice or Portal-only flag is insufficient. No Rork contour editor workstream.
5. **Metric/history blocker:** group-spacing treated-area/irrigation rules, multipart pruning/end posts, override projection, historical version linkage and all consumer safety rows need explicit signoff. Existing conversion requires complete reviewed 1:1 canonical mapping and is not the first pilot.
6. **Acceptance blocker:** no D1–D4 signed-in/isolated concurrency/mobile/offline/rollback verification has occurred for this proposal; tests in section 13 are requirements, not passed results.
7. **Commit limitation:** this environment prohibits stateful Git commands; the document can be saved but a commit cannot be created or its SHA invented. The existing repository HEAD is not a commit of this document. An authorised repository workflow must commit the documentation and return the resulting SHA.

**Shipped today: documentation only.** No private-stage implementation, public contour blocks, active paths, validator, gates, mobile changes, permission changes, migrations, historical changes or deployment. No SQL was written or executed. No source or tests were edited. Release requires separate approval after all safety blockers and D4 evidence are resolved.