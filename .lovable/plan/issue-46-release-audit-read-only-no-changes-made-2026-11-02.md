# Issue #46 release audit (read-only, no changes made)

Source HEAD: `cf2a23180d9569490e7609bac50f355eb15fbd2d` (2026-11-02 10:40 UTC).
Production: https://portal.vinetrack.com.au serves one main bundle, `assets/index-CMXz8Egu.js` (7.4 MB), downloaded and searched 11:41 UTC.

## Which revision is live
The live bundle contains code that was **only added in HEAD cf2a2318** (the resistance auto-collapse fix, compiled as `onClick:()=>c({key:o,open:!d})` with `aria-controls:"resistance-details"`). So production is serving HEAD cf2a2318 (or a later build of the same code), not just the earlier release `ffa8b30b`. The bundle has no embedded commit SHA; I identified the revision from unique code.

## Matrix

| # | Item | In code (HEAD) | Live | Tested | Gaps / evidence |
|---|------|------|------|--------|-----------------|
| 1 | "scheduled" changed to "planned" | Yes: `src/lib/sprayJobStatus.ts`, `ApplicationStep.tsx`, `SprayJobsPage.tsx`, `sprayApplicationSave.ts` | Yes: live code turns `"scheduled"` into `"planned"` (`t==="scheduled"?"planned":...`) | `src/test/sprayJobStatus.test.ts` 7/7 | Other live `"scheduled"` strings belong to separate features (newsletter/email scheduling, display filters), not the spray job save. **No signed-in production save receipt**: I had no account to sign in with. |
| 2 | CF 400/330, stale CF decision, per 100 L only | Yes: `src/lib/sprayCalculation.ts`, `CarrierStep.tsx`, `ReviewStep.tsx`, `sprayApplicationDraft.ts` | Yes: `concentration_factor_mismatch`, "CF from water rates", "Keep recorded" and "CF not applied" all found | `src/test/sprayConcentrationFactor.test.ts` 11/11 | Completed or archived jobs keep their recorded CF (read-only). |
| 3 | Manual Spray label-rate reference vs actual amounts | Yes: `src/lib/manualSpray/labelRateReference.ts`, `src/pages/setup/ManualSprayEntryPage.tsx:480` | Yes: `manual-label-rate-reference` found | Manual Spray suites 51/51 | The reference is display-only and never fills "Amount used". |
| 4 | Resistance: checkbox at top, "Show resistance details (n)", auto-collapse, footer jump | Yes: `ResistanceAcknowledgement.tsx`, `SprayJobWizard.tsx:416-417` | Yes: checkbox `resistance-ack`, toggle, keyed collapse and footer jump to `resistance-ack` all found | `src/test/resistanceUi.test.tsx` 20/20 | Wording that "missing history" is not a list of confirmed violations is live. Not checked by clicking through while signed in on production. |
| 5 | Planned spray "completed" vs real spray record start/end | Partly | Partly (same as code) | No dedicated test | `SprayJobsPage.tsx:904-965` shows linked spray records with date and start time, and warns when a matching record exists but the job is not completed. **Not built:** showing the record's end time, and entering a manual completion date/time on the planned job. |
| 6 | E-L stage per block | Partly | Partly (same as code) | Not checked this round | **Exists:** Growth Stage Records report (`src/pages/reports/GrowthStageRecordsPage.tsx`, with date/block/variety/stage/notes/photo/operator columns) and a Block Detail growth tab (`BlockDetailPage.tsx:213`, via `growthStageRecordsQuery.ts`), which already includes growth pins and their photos. **Not built:** a single "current E-L per block" summary, E-L charts over time, and auto-filling the latest E-L for each selected block in the Spray Wizard. `GrowthStageStep.tsx` is manual only, with "Not set" as the default. |

## Test commits
Tests for items 1–2 landed by `ffa8b30b`; tests for item 4 landed in `370bce4c` and `cf2a2318`. Last full spray run: 483/484. The one failure is an older heading-style test in chemical components, not related to this release.

## Blockers and open items
- No signed-in production save receipt for item 1, and no live click-through for items 2–4: I have no Portal account to sign in with. One manual save on a test vineyard closes this.
- Items 5 and 6 are only partly built. Issue #46 should stay open for: recorded end time and a manual completion time; a current E-L per block summary and charts; Spray Wizard auto-filling the latest E-L.
- Android "session expired" error: outside the Portal, not audited.
- Nothing was modified, published, or written to the database.

## Next step if approved
No code work is included. If you approve, I can write separate plans for items 5 and 6.
