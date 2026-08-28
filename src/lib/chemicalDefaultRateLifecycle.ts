// Gate D4B-P2B.1 — canonical-option lifetime + product-ownership state machine.
//
// One pure module owns every transition that can affect the operator's
// persisted `default_rates` (SQL 214 / D3) or the in-memory canonical option
// set. The editor component holds this state and never re-implements a rule.
//
// GOVERNING RULES
//
//  * Canonical options are valid ONLY for the exact authoritative structured
//    lookup that supplied them. Anything that lets the in-memory chemistry
//    diverge from that lookup invalidates them (options -> null).
//  * Invalidation NEVER clears and NEVER dirties `default_rates`.
//  * Both persisted slots are cleared ONLY when the registered product identity
//    owning the defaults is PROVEN different (old and new identity both fully
//    known and unequal). A label revision is not a product change.
//  * An unsuccessful search (failed / timeout / ambiguous / AI-only) does not
//    replace the authoritative chemistry, so it changes nothing at all.
import {
  decodePersistedDefaultRates,
  type CanonicalDefaultRateOption,
  type CanonicalDefaultRateOptions,
  type CanonicalRateBasis,
  type PersistedDefaultRates,
} from "./chemicalDefaultRatesContract";
import {
  clearAllBasisSelections,
  clearBasisSelection,
  emptyPersistedDefaultRates,
  isKnownDifferentRegisteredProduct,
  narrowedSelectionFromOption,
  selectionFromCanonicalOption,
  withBasisSelection,
  type RegisteredProductIdentity,
} from "./chemicalDefaultRateSelection";

export interface DefaultRateLifecycleState {
  /** Persisted contract value. Written on save only when `dirty`. */
  defaultRates: PersistedDefaultRates;
  /** Omit-vs-write gate for `saved_chemicals.default_rates`. */
  dirty: boolean;
  /** Backend options from the current authoritative lookup; null => unavailable. */
  canonicalOptions: CanonicalDefaultRateOptions | null;
  /** Registered product the persisted defaults belong to (null => unknown). */
  productIdentity: RegisteredProductIdentity | null;
  /** Label version stamped onto a new operator selection. */
  labelVersion: string | null;
  /** True once defaults were cleared because the product provably changed. */
  productChangedNotice: boolean;
}

/** A brand-new chemical: empty version-1 defaults, nothing fetched yet. */
export function newDefaultRateLifecycle(): DefaultRateLifecycleState {
  return {
    defaultRates: emptyPersistedDefaultRates(),
    dirty: false,
    canonicalOptions: null,
    productIdentity: null,
    labelVersion: null,
    productChangedNotice: false,
  };
}

/**
 * Reopening a Saved Chemical. Defaults come ONLY from the stored contract and
 * there is no automatic lookup, so canonical options stay unavailable and the
 * snapshot is displayed from itself.
 */
export function hydrateDefaultRateLifecycle(input: {
  storedDefaultRates: unknown;
  productIdentity: RegisteredProductIdentity | null;
  labelVersion: string | null;
}): DefaultRateLifecycleState {
  return {
    defaultRates: decodePersistedDefaultRates(input.storedDefaultRates) ?? emptyPersistedDefaultRates(),
    dirty: false,
    canonicalOptions: null,
    productIdentity: input.productIdentity,
    labelVersion: input.labelVersion,
    productChangedNotice: false,
  };
}

/** Clears both slots when — and only when — the product provably changed. */
function withProductIdentity(
  state: DefaultRateLifecycleState,
  nextIdentity: RegisteredProductIdentity | null,
): DefaultRateLifecycleState {
  const changed = isKnownDifferentRegisteredProduct(state.productIdentity, nextIdentity);
  return {
    ...state,
    defaultRates: changed ? clearAllBasisSelections() : state.defaultRates,
    dirty: changed ? true : state.dirty,
    productChangedNotice: changed,
    // An unknown new identity must not erase the identity that owns the
    // persisted defaults.
    productIdentity: nextIdentity ?? state.productIdentity,
  };
}

/**
 * An authoritative structured lookup was applied (§1, §2).
 *
 * `options` is the backend `default_rate_options` block, or null when the
 * response carried none — in which case the previous options are dropped as
 * unavailable while the persisted selection and dirty flag stay untouched.
 * A lookup by itself never selects, creates or modifies a default.
 */
export function applyAuthoritativeChemistry(
  state: DefaultRateLifecycleState,
  input: {
    productIdentity: RegisteredProductIdentity | null;
    options: CanonicalDefaultRateOptions | null;
    labelVersion: string | null;
  },
): DefaultRateLifecycleState {
  return {
    ...withProductIdentity(state, input.productIdentity),
    canonicalOptions: input.options ?? null,
    labelVersion: input.labelVersion,
  };
}

/**
 * Chemistry was replaced from a non-lookup source (§4, §5): an accepted Master
 * update or a different Master product. Canonical options are never derived
 * from Master data, so they simply become unavailable until a fresh
 * authoritative lookup runs.
 */
export function applyReplacedChemistry(
  state: DefaultRateLifecycleState,
  input: { productIdentity: RegisteredProductIdentity | null; labelVersion?: string | null },
): DefaultRateLifecycleState {
  return {
    ...withProductIdentity(state, input.productIdentity),
    canonicalOptions: null,
    labelVersion: input.labelVersion === undefined ? state.labelVersion : input.labelVersion,
  };
}

/**
 * Manual edit to registered uses or registration identity (§3, §6). Only the
 * in-memory option set is invalidated; the persisted snapshot survives and the
 * dirty flag is untouched.
 */
export function invalidateCanonicalOptions(
  state: DefaultRateLifecycleState,
): DefaultRateLifecycleState {
  return state.canonicalOptions === null ? state : { ...state, canonicalOptions: null };
}

/**
 * An unsuccessful search attempt (§7). It did not replace the authoritative
 * chemistry, so nothing changes — a failed lookup can never destroy an
 * operator decision.
 */
export function applyUnsuccessfulLookup(
  state: DefaultRateLifecycleState,
): DefaultRateLifecycleState {
  return state;
}

/** Operator click: copy the backend option and stamp operator provenance. */
export function selectDefaultRate(
  state: DefaultRateLifecycleState,
  option: CanonicalDefaultRateOption,
  basis: CanonicalRateBasis,
  selectedAt: string,
): DefaultRateLifecycleState {
  return {
    ...state,
    defaultRates: withBasisSelection(
      state.defaultRates,
      basis,
      selectionFromCanonicalOption(option, {
        source: "operator",
        selectedAt,
        labelVersion: state.labelVersion,
      }),
    ),
    dirty: true,
    productChangedNotice: false,
  };
}

/**
 * PART 10 — the vineyard's usual dose INSIDE an authoritative label range.
 * The registered range itself is untouched; only the operator's own selection
 * narrows to a single value that still cites the range option's identity.
 * Callers must validate the value first (`validateVineyardDose`).
 */
export function selectVineyardDose(
  state: DefaultRateLifecycleState,
  option: CanonicalDefaultRateOption,
  basis: CanonicalRateBasis,
  value: number,
  selectedAt: string,
): DefaultRateLifecycleState {
  return {
    ...state,
    defaultRates: withBasisSelection(
      state.defaultRates,
      basis,
      narrowedSelectionFromOption(option, value, {
        selected_at: selectedAt,
        label_version: state.labelVersion,
      }),
    ),
    dirty: true,
    productChangedNotice: false,
  };
}

/** Explicit clear of one basis slot; the other slot is preserved. */
export function clearDefaultRate(
  state: DefaultRateLifecycleState,
  basis: CanonicalRateBasis,
): DefaultRateLifecycleState {
  return {
    ...state,
    defaultRates: clearBasisSelection(state.defaultRates, basis),
    dirty: true,
    productChangedNotice: false,
  };
}
