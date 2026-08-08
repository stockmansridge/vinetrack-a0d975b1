// Canonical pin placement contract (SQL 171).
//
// The portal MUST NOT derive placement/assignment from the base `pins`
// row (paddock_id / row_number / snapped_* etc). The backend view
// `public.pin_placements` is the single source of truth; this module only
// formats what the view returns.
//
// Placement never affects category colour. The amber "Unassigned location"
// treatment is shown ONLY when location_warning_code = 'unassigned_location'.

export type PinLocationScope = "point" | "row" | "block" | string;

export type PinLocationAssignmentBasis =
  | "point_coordinates"
  | "snapped_point"
  | "block"
  | "row_segments"
  | string;

export type PinLocationWarningCode =
  | "unassigned_location"
  | "location_metadata_incomplete"
  | string;

/** One row of `public.pin_placements`. */
export interface PinPlacementRow {
  pin_id: string;
  vineyard_id?: string | null;
  location_scope?: PinLocationScope | null;
  is_location_assigned?: boolean | null;
  location_assignment_basis?: PinLocationAssignmentBasis | null;
  paddock_id?: string | null;
  paddock_name?: string | null;
  row_summary?: string | null;
  has_row_segments?: boolean | null;
  snapped_to_row?: boolean | null;
  driving_row_number?: number | null;
  pin_row_number?: number | null;
  pin_side?: string | null;
  along_row_distance_m?: number | null;
  location_warning_code?: PinLocationWarningCode | null;
}

export interface PinPlacementDisplay {
  /** From the view only. */
  assigned: boolean;
  /** Amber warning — genuine unassigned_location only. */
  showWarning: boolean;
  /** Informational only; never amber. */
  metadataIncomplete: boolean;
  /** Table "Block" cell / drawer block line. */
  blockLabel: string;
  /** Table "Row" cell — may be multi-line (newline separated). */
  rowLabel: string;
  /** Individual row lines, for surfaces that render them as fields. */
  rowLines: string[];
  /** True when the view supplied any row information at all. */
  hasRowInfo: boolean;
  /** Drawer "Assignment" line, when there is no block name to show. */
  assignmentLabel: string | null;
  scope: PinLocationScope | null;
  basis: PinLocationAssignmentBasis | null;
  paddockName: string | null;
  rowSummary: string | null;
}


export const UNASSIGNED_LABEL = "Unassigned location";
export const POINT_LOCATION_LABEL = "Point location";

const EM_DASH = "—";

/**
 * Format a placement row for display. A missing row (view not yet loaded, or
 * no placement produced) is rendered neutrally — never amber, because amber
 * must not be inferred from absent base fields.
 */
export function pinPlacementDisplay(
  row: PinPlacementRow | null | undefined,
): PinPlacementDisplay {
  const warning = (row?.location_warning_code ?? null) || null;
  const showWarning = warning === "unassigned_location";
  const metadataIncomplete = warning === "location_metadata_incomplete";
  const assigned = row?.is_location_assigned === true;
  const scope = (row?.location_scope ?? null) || null;
  const basis = (row?.location_assignment_basis ?? null) || null;
  const paddockName = (row?.paddock_name ?? "").trim() || null;
  const rowSummary = (row?.row_summary ?? "").trim() || null;

  let blockLabel = EM_DASH;
  let assignmentLabel: string | null = null;

  if (showWarning) {
    blockLabel = UNASSIGNED_LABEL;
    assignmentLabel = UNASSIGNED_LABEL;
  } else if (paddockName) {
    blockLabel = paddockName;
  } else if (assigned && (scope === "point" || basis === "point_coordinates" || basis === "snapped_point")) {
    blockLabel = POINT_LOCATION_LABEL;
    assignmentLabel = POINT_LOCATION_LABEL;
  }

  return {
    assigned,
    showWarning,
    metadataIncomplete,
    blockLabel,
    rowLabel: rowSummary ?? EM_DASH,
    assignmentLabel,
    scope,
    basis,
    paddockName,
    rowSummary,
  };
}
