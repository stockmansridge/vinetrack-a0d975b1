# Soil Analysis multi-block Trends

## Requested result
- Select one or more name-sorted blocks with shared chips, All blocks and Clear controls.
- Plot one compatible analyte series with separate raw samples and date-average lines for each block; never average across blocks.
- Show per-block latest values, changes, laboratory status and sample/date counts, retaining selected blocks without data.
- Add Block to the oldest-first raw table and update only the Trends help step.

## Technical details
- Add `listBlocksAnalyteResults` using the existing mapping resolver and server-side analyte filter, preserving the current sample visibility semantics.
- Reuse Compare's selection pattern in a small shared control without changing its reporting behaviour.
- Keep existing strict/provisional visual-series rules; partition an active series by matched block before averaging or summarising.
- Test mapped-result deduplication, analyte filtering, selection, compatibility and block-isolated averages, plus existing release/navigation regressions.
- No SQL, schema, functions, ingestion, mobile or publication changes.

