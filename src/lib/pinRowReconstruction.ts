import { RECOVERY_VINEYARD_ID, type RecoveryRow } from "@/lib/pinRowRecovery";
import { csvCell } from "@/lib/pinRowReviewDraft";

export interface ServerPinReconstruction {
  pin_id: string; tier: string; holds: string[];
  proposed_block_id?: string | null;
  block?: { paddock_id?: string | null; source?: string };
  gps?: { raw_latitude?: number | null; raw_longitude?: number | null; horizontal_accuracy_m?: number | null; accuracy_source?: string };
  travel?: { ok?: boolean; course_deg?: number | null; source?: string; reason?: string };
  side?: { value?: "left" | "right" | null; sources?: Record<string, string>; conflict?: boolean };
  geometry?: Record<string, unknown>;
  suggestion?: { vine_row?: number | null; driving_aisle?: number | null; bounding_rows?: number[] | null; snap?: unknown };
  sync_version?: number | string | null; updated_at?: string | null;
  [key: string]: unknown;
}
export interface ServerReconstructionReport {
  algorithm_version: string; generated_at: string; read_only: true;
  validation: { passed: boolean; [key: string]: unknown };
  pins: ServerPinReconstruction[]; supported_batch: ServerPinReconstruction[];
  missing_total?: number; by_tier?: Record<string, number>;
  [key: string]: unknown;
}

export function reconstructionError(error: any): string {
  const actual = [error?.message, error?.details, error?.hint].filter(Boolean).join(" — ") || String(error);
  // Permission errors must never be mislabelled as missing functions.
  if (error?.code === "42501" || /not authori[sz]ed|permission|forbidden|unauthori[sz]ed/i.test(actual))
    return `Permission denied by VineTrack: ${actual}`;
  return `${error?.code ? `${error.code}: ` : ""}${actual}`;
}

export async function fetchServerReconstruction(db: any, userId: string | null): Promise<ServerReconstructionReport> {
  if (!userId) throw new Error("Sign in to VineTrack before running server reconstruction.");
  const { data, error } = await db.rpc("pin_row_reconstruction_report", { p_vineyard: RECOVERY_VINEYARD_ID });
  if (error) throw new Error(reconstructionError(error));
  if (!data || data.read_only !== true || data.algorithm_version !== "pbf-recon-v2" ||
      !Array.isArray(data.pins) || !Array.isArray(data.supported_batch) || typeof data.validation?.passed !== "boolean" ||
      data.synthetic === true || data.demo === true || data.source === "synthetic")
    throw new Error("Unrecognised server reconstruction response — no candidates accepted.");
  return data;
}

/** UI eligibility is a restriction of the server's batch, never a new row calculation. */
export function supportedCandidate(report: ServerReconstructionReport | null, pinId: string): ServerPinReconstruction | null {
  if (!report || report.validation.passed !== true) return null;
  const pins = report.pins.filter((p) => p.pin_id === pinId);
  const batch = report.supported_batch.filter((p) => p.pin_id === pinId);
  const p = pins[0]; const b = batch[0];
  if (pins.length !== 1 || batch.length !== 1 || !p || !b || p.tier !== "technically_supported" || b.tier !== "technically_supported" ||
      !Array.isArray(p.holds) || p.holds.length || !Number.isInteger(p.suggestion?.vine_row) ||
      p.suggestion?.vine_row !== b.suggestion?.vine_row || p.suggestion?.driving_aisle !== b.suggestion?.driving_aisle ||
      p.proposed_block_id !== b.proposed_block_id || p.side?.value !== b.side?.value ||
      !p.proposed_block_id || p.travel?.ok !== true || p.travel.course_deg == null || !Number.isFinite(p.travel.course_deg) ||
      !p.side?.value || p.side.conflict || p.geometry?.geometry_source !== "capture_time_history" ||
      !p.geometry.geometry_identity || p.geometry.geometry_identity !== p.geometry.current_geometry_identity)
    return null;
  return p;
}

export function candidateMatchesPin(p: ServerPinReconstruction, r: RecoveryRow): boolean {
  return r.status !== "preserve_existing" && r.pin.row_number == null && r.pin.pin_row_number == null &&
    r.pin.driving_row_number == null && r.pin.location_scope !== "row" && r.segmentsState !== "unavailable" &&
    !r.existingMeta && r.pin.vineyard_id === RECOVERY_VINEYARD_ID &&
    (!r.pin.paddock_id || r.pin.paddock_id === p.proposed_block_id) &&
    String(r.pin.sync_version ?? "") === String(p.sync_version ?? "") &&
    (r.pin.updated_at ?? null) === (p.updated_at ?? null) &&
    Number(r.pin.latitude) === p.gps?.raw_latitude && Number(r.pin.longitude) === p.gps?.raw_longitude;
}

export function reconstructionCsv(report: ServerReconstructionReport): string {
  const columns = ["algorithm_version", "generated_at", "pin_id", "tier", "block_id", "travel_degrees", "travel_source", "side", "side_sources", "driving_aisle", "physical_vine_row", "gps_accuracy_m", "geometry", "holds", "exact_server_pin_json"];
  return [columns.join(","), ...report.pins.map((p) => [report.algorithm_version, report.generated_at, p.pin_id, p.tier,
    p.proposed_block_id, p.travel?.course_deg, p.travel?.source, p.side?.value, JSON.stringify(p.side?.sources),
    p.suggestion?.driving_aisle, p.suggestion?.vine_row, p.gps?.horizontal_accuracy_m,
    JSON.stringify(p.geometry), JSON.stringify(p.holds), JSON.stringify(p)].map(csvCell).join(","))].join("\n");
}