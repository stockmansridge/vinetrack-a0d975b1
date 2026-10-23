// Spray Program progression — Portal mirror of iOS SprayProgramProgression.
//
// Pure derivation only: NEVER writes or materialises spray_jobs. Program
// Steps stay reusable until the user explicitly chooses Plan Spray.
//
// Contract:
//  * Only COMPLETED, non-template operational spray records inside the
//    selected Vintage window advance progression (caller passes the scope).
//  * Completion: spray_record.spray_job_id === Program Step id wins. Legacy
//    fallback (record has no spray_job_id) needs the SAME E-L stage AND a
//    normalised name / spray reference match — never every step at a stage.
//  * Steps earlier than the highest completed E-L stage and completed steps
//    are removed; unrelated steps at the same stage stay.
//  * Remaining staged steps sort numerically by E-L ascending ("Next from
//    Program"); unstaged remaining steps are "Other Program Steps".
import type { SprayJob } from "@/lib/sprayJobsQuery";
import { growthStageOrder } from "@/lib/sprayProgramStep";
import { isWithinVintage, type VintageScope } from "@/lib/vintageScope";
import { vintageForDate } from "@/lib/vineyardSeasonSettingsQuery";

export interface ProgressionRecord {
  id: string;
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  trip_id?: string | null;
  spray_job_id?: string | null;
  spray_reference?: string | null;
  growth_stage_code?: string | null;
  is_template?: boolean | null;
  deleted_at?: string | null;
}

/** All E-L stage numbers mentioned in free text ("E-L Stage 2-3" → [2,3]). */
export function parseElStages(text?: string | null): number[] {
  if (!text) return [];
  const out: number[] = [];
  const re = /E\s*-?\s*L\s*(?:stage\s*)?(\d{1,2})(?:\s*(?:-|–|to)\s*(?:E\s*-?\s*L\s*)?(\d{1,2}))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = Number(m[1]);
    const b = m[2] != null ? Number(m[2]) : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.push(n);
  }
  return out;
}

/** Lowercase alphanumerics with E-L stage tokens removed. */
export function normaliseStepName(s?: string | null): string {
  return String(s ?? "")
    .replace(/E\s*-?\s*L\s*(?:stage\s*)?\d{1,2}(?:\s*(?:-|–|to)\s*\d{1,2})?/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** A record is complete unless it is a tracked trip still in progress. */
export function isCompletedRecord(r: ProgressionRecord): boolean {
  if (r.is_template || r.deleted_at) return false;
  if (r.trip_id && r.start_time && !r.end_time) return false;
  return true;
}

function recordStages(r: ProgressionRecord, stepById: Map<string, SprayJob>): number[] {
  const linked = r.spray_job_id ? stepById.get(r.spray_job_id) : undefined;
  const linkedStage = linked ? growthStageOrder(linked.growth_stage_code) : null;
  if (linkedStage != null) return [linkedStage];
  const code = growthStageOrder(r.growth_stage_code);
  if (code != null) return [code];
  return parseElStages(r.spray_reference);
}

export interface ProgressionResult {
  highestCompletedStage: number | null;
  completedStepIds: Set<string>;
  nextFromProgram: SprayJob[];
  otherProgramSteps: SprayJob[];
}

export function deriveProgramProgression(
  steps: SprayJob[],
  records: ProgressionRecord[],
  scope: VintageScope | null,
): ProgressionResult {
  const program = steps.filter((s) => s.is_template && !s.deleted_at);
  const stepById = new Map(program.map((s) => [s.id, s]));
  const done = records.filter(
    (r) => isCompletedRecord(r) && (scope ? isWithinVintage(r.date ?? null, scope) : true),
  );

  let highest: number | null = null;
  const completed = new Set<string>();
  for (const r of done) {
    const stages = recordStages(r, stepById);
    for (const n of stages) highest = highest == null ? n : Math.max(highest, n);
    if (r.spray_job_id) {
      // Provenance wins; no legacy guessing for linked records.
      if (stepById.has(r.spray_job_id)) completed.add(r.spray_job_id);
      continue;
    }
    const ref = normaliseStepName(r.spray_reference);
    if (!ref || !stages.length) continue;
    for (const s of program) {
      const st = growthStageOrder(s.growth_stage_code);
      if (st == null || !stages.includes(st)) continue;
      const name = normaliseStepName(s.name);
      if (name && (name === ref || ref.includes(name) || name.includes(ref))) completed.add(s.id);
    }
  }

  const remaining = program.filter((s) => !completed.has(s.id));
  const staged = remaining
    .filter((s) => {
      const st = growthStageOrder(s.growth_stage_code);
      return st != null && (highest == null || st >= highest);
    })
    .sort((a, b) =>
      (growthStageOrder(a.growth_stage_code)! - growthStageOrder(b.growth_stage_code)!) ||
      String(a.name ?? "").localeCompare(String(b.name ?? "")),
    );
  const other = remaining.filter((s) => growthStageOrder(s.growth_stage_code) == null);
  return { highestCompletedStage: highest, completedStepIds: completed, nextFromProgram: staged, otherProgramSteps: other };
}

/** Vintage a planned job belongs to (season-window based, never calendar year). */
export function jobVintage(j: Pick<SprayJob, "planned_date">, seasonMonth: number, seasonDay: number): number | null {
  if (!j.planned_date) return null;
  const iso = String(j.planned_date).slice(0, 10);
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? null : vintageForDate(d, seasonMonth, seasonDay);
}
