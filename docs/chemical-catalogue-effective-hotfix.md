# Portal v3.1.9 catalogue hotfix (unpublished)

The owner-deployed `saved_chemicals_effective` security-invoker view supersedes the earlier pinned-copy freshness presentation. No schema, function, permission, trigger or scheduled-job changes are included.

- The existing shared chemical reader uses the effective view under the same selected-vineyard and active/archived tombstone predicates. Chemical details reread on opening rather than retaining their opening snapshot.
- Current approved identity is checked against the exact product approved pointer. The effective revision supplies display enrichment; a rejected/pending product's original fallback data is not labelled approved. Errors/offline reads surface rather than falling back to raw rows.
- Catalogue reference panels retain the exact product/revision approval checks and all rate options, targets, restrictions and evidence. No label range becomes an applied dose; existing explicit vineyard preferred/default selections retain their established precedence.
- Linked editor saves allow changed vineyard-owned settings only, never effective catalogue projections. Base-table writes retain vineyard, pinned product/revision and available version/timestamp predicates, then read back through the live view. Effective full-row insert/update attempts are rejected.
- Approval and save refresh both existing chemical query-key families. Server approval-copy advancement and nightly repair remain backup mechanisms, not Portal jobs.

Focused tests: 90 passing across seven files. Preview compilation passed. Actual Chemical Store navigation redirects to `/login`; shared-vineyard signed-in visual/save/approval acceptance remains unverified. No customer mutations, mobile/Trip changes or publication were performed.