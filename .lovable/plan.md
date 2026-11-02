# Greg incident triage — Planned Spray / Manual Spray / Scout (read-only findings)

No code, database, mobile, auth or Issue #43 work is proposed for this turn. Approving this plan records the findings only; each fix below needs its own go-ahead.

## 1. Status "scheduled" fails with spray_jobs_status_check — HIGH, likely Portal bug
Known:
- `src/components/spray/wizard/ApplicationStep.tsx:25` and `src/pages/setup/SprayJobsPage.tsx:83` both offer `["draft","scheduled","in_progress","completed","cancelled"]`.
- Save passes `app.status ?? "draft"` through (`src/lib/sprayApplicationSave.ts:249`). Program import and Program Step creation hard-code `"draft"`.
- `src/test/sprayWizardStage3b.test.ts:368` uses `"planned"`, which does not appear in the option list.
Unknown:
- The real constraint. `spray_jobs` lives in the shared mobile backend; it is not in this project's tables or SQL, so the allowed values could not be read.
Smallest safe fix (after the allowed values are confirmed):
- Read `pg_get_constraintdef` for `spray_jobs_status_check`, then make both option lists one shared constant that matches it exactly.
- Keep the rest of the UI unchanged. Add a test that every offered status is in the confirmed allowed set.
- If iOS writes a different value (for example "planned"), relabel it rather than remap stored rows.

## 2. Resistance step: "indeterminate" verdict, checkbox hidden on Review — MEDIUM
Known:
- Review shows `ResistanceAcknowledgement`, built from `resistance.overallStatus` and `requiresAcknowledgement` (`SprayJobWizard.tsx:326`).
- The component returns nothing when `status` is null (`ResistanceAcknowledgement.tsx:49`).
- The engine sets evidence quality to `"indeterminate"` for opaque or unattributed evidence (`resistanceEngine.ts:892/907/1068/1158`). The card labels this "Incomplete evidence".
Unknown:
- Whether Greg's job reaches Review with a null status or with `requiresAcknowledgement=false`. Either one hides the checkbox.
- Whether saving was blocked or allowed. I need his job id or the step-23 inputs to reproduce it.
Proposed:
- Reproduce with a mocked engine result where evidence is indeterminate.
- If confirmed, show a "Resistance could not be fully assessed" notice on Review whenever status is null or evidence is indeterminate.
- Do not change the acknowledgement rules without approval: they are regulatory/advisory semantics.

## 3. CF 1.21 (400 dilute / 330 applied) changes quantities or stays at 1 — MEDIUM, cause unconfirmed
Known (`src/lib/sprayCalculation.ts:277-293`):
- A persisted `concentrationFactor` wins over the derived one.
- The manual basis is forced to 1.00.
- CF is derived only when nothing is persisted.
- So a job that was once saved with CF 1 (or switched to manual) keeps 1 even after volumes give 400/330 = 1.21. Re-opening a job that has no persisted CF re-derives it, which changes product quantities.
Unknown:
- Which path Greg hit. That needs the job's stored `concentration_factor`, carrier basis and dilute/applied values.
Proposed:
- Test both cases: persisted 1 with 400/330 → shows 1 plus a visible "differs from derived 1.21" notice; nothing persisted → 1.21.
- Never silently overwrite a persisted value.

## 4. Completed planned spray has no actual completion timestamp — gap, not a bug
Known:
- The Planned Spray status is just a select value.
- Completion evidence comes from linked spray records (`SprayJobsPage.tsx:923-945` warns when they don't match).
- `end_time` exists only on the record type (`sprayJobsQuery.ts:434`).
Unknown:
- Whether `spray_jobs` has a completed-at column in the shared schema.
Proposed:
- Show the linked spray record's end time as "Completed at", read-only.
- Don't add a field to the job without a schema decision.

## 5. Manual Spray expects actual amounts, not label rate per 100 L — working as designed
Known:
- `ManualSprayEntryPage.tsx:184`: "The amount is always the operator's entry — never a store default rate."
Proposed:
- Copy only: a helper line under the amount field saying "Enter the total actual amount used".
- Optionally show the label rate as read-only reference. No change to calculations.

## 6. Recent EL stage per block (mobile has it, Portal doesn't) — feature gap
Known:
- The Portal has `ELStagesButton`, `GrowthStageHeatmap` and a growth step in the wizard. No per-block "latest EL" column was found on the Blocks pages.
Unknown:
- Which mobile table or field is the source.
Proposed:
- After confirming the mobile source, add a read-only latest EL plus date to Block Detail.

## 7. Android Scout "Sync failed: Your session has expired" with unsynced photos — out of scope
- This is mobile/auth and not in the Portal source. The Portal's similar strings are unrelated (`adminDeleteUser.ts`, `wundergroundProxy.ts`).
- Advice to Greg: do not sign out or reinstall until the Android team confirms the photos are kept locally.

## Priority
1 (blocks saving) → 3 (wrong quantities) → 2 → 4 → 5 → 6. Item 7 goes to the mobile team.

## Needed from you / Greg
- The `spray_jobs_status_check` definition from the shared backend.
- Greg's planned spray id(s) for items 2 and 3.
