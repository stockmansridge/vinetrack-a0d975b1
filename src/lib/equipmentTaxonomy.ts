// Shared Tractor / Vineyard Machine taxonomy contract (Portal).
//
// Established by SQL 206/207 and the iOS user-facing equipment contract:
//
//   * Tractors are created and managed ONLY under Setup › Tractors, in
//     `public.tractors`.
//   * Vineyard Machines is for ATVs, side-by-sides, harvesters, utility
//     vehicles and other powered vineyard machines.
//   * A genuine tractor MAY (and after SQL 209 always WILL) have a linked
//     `vineyard_machines` row with machine_type = 'tractor' and
//     legacy_tractor_id = tractors.id. That row is an INTERNAL representation
//     so trips / fuel logs / spray records can keep using machine_id.
//     It must never be presented to a user as an ordinary Vineyard Machine.
//   * A `vineyard_machines` row with machine_type = 'tractor' and
//     legacy_tractor_id IS NULL is an ORPHAN created through the old mobile
//     Vineyard Machines path (integrity check C9). It is a real tractor that
//     has not been promoted yet — surface it for review, never as a normal
//     machine, and never silently hide it.
//
// Nothing here reads or writes; it is pure classification so every consumer
// (pages, selectors, health checks, coverage diagnostics) shares one rule.

export type MachineTypeValue =
  | "tractor"
  | "atv"
  | "side_by_side"
  | "harvester"
  | "utility_vehicle"
  | "other_vineyard_machine";

/** Machine types a user may create/edit under Vineyard Machines. No tractor. */
export const USER_MACHINE_TYPES = [
  "atv",
  "side_by_side",
  "harvester",
  "utility_vehicle",
  "other_vineyard_machine",
] as const satisfies ReadonlyArray<MachineTypeValue>;

export type UserMachineType = (typeof USER_MACHINE_TYPES)[number];

export function isUserMachineType(t: string | null | undefined): t is UserMachineType {
  return !!t && (USER_MACHINE_TYPES as ReadonlyArray<string>).includes(t);
}

export interface MachineTaxonomyRow {
  id?: string;
  machine_type?: string | null;
  legacy_tractor_id?: string | null;
  deleted_at?: string | null;
}

const isTractorTyped = (m: MachineTaxonomyRow) => (m.machine_type ?? "") === "tractor";

/** Internal mirror of a `tractors` row. Hidden from the machines UI. */
export function isLinkedTractorMirror(m: MachineTaxonomyRow): boolean {
  return isTractorTyped(m) && !!m.legacy_tractor_id;
}

/** Tractor recorded as a machine with no `tractors` row — C9 / needs review. */
export function isOrphanTractorMachine(m: MachineTaxonomyRow): boolean {
  return isTractorTyped(m) && !m.legacy_tractor_id;
}

/** A genuine, user-managed Vineyard Machine (never a tractor of any kind). */
export function isUserVineyardMachine(m: MachineTaxonomyRow): boolean {
  return !isTractorTyped(m);
}

export interface MachinePartition<T extends MachineTaxonomyRow> {
  /** Shown in the Vineyard Machines list and counted as machines. */
  machines: T[];
  /** Internal tractor representations — hidden everywhere in the machines UI. */
  mirrors: T[];
  /** Orphan tractor-machines — shown in a separate "Needs review" state. */
  needsReview: T[];
}

export function partitionMachines<T extends MachineTaxonomyRow>(rows: T[]): MachinePartition<T> {
  const out: MachinePartition<T> = { machines: [], mirrors: [], needsReview: [] };
  for (const r of rows) {
    if (isLinkedTractorMirror(r)) out.mirrors.push(r);
    else if (isOrphanTractorMachine(r)) out.needsReview.push(r);
    else out.machines.push(r);
  }
  return out;
}

/**
 * Write guard. The Portal must never create or convert a vineyard_machines row
 * into an unlinked tractor-machine — that is exactly what produced the campesi
 * C9 row. Linked mirrors are created server-side by the tractor write path.
 */
export class TractorMachineTaxonomyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TractorMachineTaxonomyError";
  }
}

export function assertUserMachineType(t: string | null | undefined): asserts t is UserMachineType {
  if (isTractorTyped({ machine_type: t })) {
    throw new TractorMachineTaxonomyError(
      "Tractors are managed under Setup › Tractors. A Vineyard Machine cannot be saved as a tractor.",
    );
  }
  if (!isUserMachineType(t)) {
    throw new TractorMachineTaxonomyError(`Unsupported machine type: ${String(t)}`);
  }
}
