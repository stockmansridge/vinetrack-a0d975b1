// Informational per-block allocation of parent pruning activity labour/cost.
//
// SQL 166 records ONE parent activity with N block allocations. The activity
// carries the labour hours and the labour cost; individual allocations do not.
// The report must therefore:
//   * show the parent activity labour/cost exactly once, and
//   * show an informational per-block split so each block has meaningful
//     costing.
//
// Split rule (matches the SQL 166 informational fields):
//   share            = allocation row equivalents / activity row equivalents
//   allocated hours  = activity labour hours * share
//   allocated cost   = allocated hours * activity hourly rate
//
// Rounded values are reconciled back to the parent total: any rounding
// remainder is applied to the largest allocation (ties -> the last one), so
// the allocated columns always add up to the activity total.

export interface AllocationInput {
  /** Stable allocation identifier (the pruning entry id). */
  id: string;
  rowEquivalents: number;
  /** SQL 166 informational field, when the backend supplies it. */
  serverShare?: number | null;
  /** SQL 166 informational field, when the backend supplies it. */
  serverHours?: number | null;
}

export interface AllocationResult {
  id: string;
  share: number;
  hours: number;
  cost: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Allocate an activity's labour hours and labour cost across its blocks.
 * `activityHours` / `activityCost` are the parent totals (null when unknown).
 */
export function allocateActivityShares(
  allocations: AllocationInput[],
  activityHours: number | null,
  activityCost: number | null,
): AllocationResult[] {
  if (!allocations.length) return [];

  const totalRowEq = allocations.reduce((s, a) => s + (Number(a.rowEquivalents) || 0), 0);

  const shares = allocations.map((a) => {
    if (a.serverShare != null && Number.isFinite(a.serverShare)) return Number(a.serverShare);
    if (totalRowEq > 0) return (Number(a.rowEquivalents) || 0) / totalRowEq;
    return 1 / allocations.length;
  });
  const shareSum = shares.reduce((s, v) => s + v, 0);
  const normalised = shareSum > 0 ? shares.map((s) => s / shareSum) : shares.map(() => 1 / allocations.length);

  const hoursTotal = activityHours ?? 0;
  const costTotal = activityCost ?? 0;

  const rawHours = allocations.map((a, i) =>
    a.serverHours != null && Number.isFinite(a.serverHours)
      ? Number(a.serverHours)
      : hoursTotal * normalised[i],
  );
  const rawCost = normalised.map((s) => costTotal * s);

  const hours = rawHours.map(round2);
  const cost = rawCost.map(round2);

  // Reconcile rounding drift onto the largest allocation (last one on a tie).
  let largest = 0;
  normalised.forEach((s, i) => { if (s >= normalised[largest]) largest = i; });

  if (activityHours != null) {
    const drift = round2(activityHours - hours.reduce((s, v) => s + v, 0));
    if (drift !== 0) hours[largest] = round2(hours[largest] + drift);
  }
  if (activityCost != null) {
    const drift = round2(activityCost - cost.reduce((s, v) => s + v, 0));
    if (drift !== 0) cost[largest] = round2(cost[largest] + drift);
  }

  return allocations.map((a, i) => ({
    id: a.id,
    share: normalised[i],
    hours: hours[i],
    cost: cost[i],
  }));
}
