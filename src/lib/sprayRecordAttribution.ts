// Stage 3A — reading block attribution off a recorded spray.
//
// `spray_records.application_blocks` is the frozen per-block record written by
// whoever applied the spray. It is the only source of truth for what was
// treated; the portal must never re-derive it from today's block geometry.
// When it is absent the honest answer is "Blocks not recorded".
import type { GeometryQuality, GeometrySource } from "@/lib/sprayApplicationGeometry";

export interface RecordedBlock {
  blockId: string | null;
  /** Name as recorded, when the payload carried one. */
  recordedName: string | null;
  grossAreaHa: number | null;
  treatedAreaHa: number | null;
  canonicalRowLengthMetres: number | null;
  rowSpacingMetres: number | null;
  rowCount: number | null;
  geometrySource: GeometrySource | null;
  geometryQuality: GeometryQuality | null;
}

export interface RecordedBlockAttribution {
  status: "recorded" | "not_recorded";
  blocks: RecordedBlock[];
  /** Legacy `block_ids` fallback, when no structured payload exists. */
  legacyBlockIds: string[];
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
};

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const t = value.trim();
  if (!t.startsWith("[") && !t.startsWith("{")) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** Defensive read of `application_blocks` (+ legacy `block_ids`). */
export function readApplicationBlocks(record: Record<string, any> | null | undefined): RecordedBlockAttribution {
  const raw = parseJson(record?.application_blocks);
  const legacyIds = (Array.isArray(record?.block_ids) ? record?.block_ids : [])
    .map((v: unknown) => str(v))
    .filter((v: string | null): v is string => !!v);

  const list = Array.isArray(raw) ? raw : [];
  const blocks: RecordedBlock[] = list
    .filter((b) => b && typeof b === "object")
    .map((b: any) => ({
      blockId: str(b.blockId ?? b.block_id ?? b.paddockId ?? b.paddock_id),
      recordedName: str(b.blockName ?? b.block_name ?? b.name),
      grossAreaHa: num(b.grossAreaHa ?? b.gross_area_ha),
      treatedAreaHa: num(b.treatedAreaHa ?? b.treated_area_ha),
      canonicalRowLengthMetres: num(b.canonicalRowLengthMetres ?? b.canonical_row_length_metres),
      rowSpacingMetres: num(b.rowSpacingMetres ?? b.row_spacing_metres),
      rowCount: num(b.rowCount ?? b.row_count),
      geometrySource: (str(b.geometrySource ?? b.geometry_source) as GeometrySource | null) ?? null,
      geometryQuality: (str(b.geometryQuality ?? b.geometry_quality) as GeometryQuality | null) ?? null,
    }));

  if (blocks.length) return { status: "recorded", blocks, legacyBlockIds: legacyIds };
  if (legacyIds.length) {
    return {
      status: "recorded",
      blocks: legacyIds.map((id) => ({
        blockId: id,
        recordedName: null,
        grossAreaHa: null,
        treatedAreaHa: null,
        canonicalRowLengthMetres: null,
        rowSpacingMetres: null,
        rowCount: null,
        geometrySource: null,
        geometryQuality: null,
      })),
      legacyBlockIds: legacyIds,
    };
  }
  return { status: "not_recorded", blocks: [], legacyBlockIds: [] };
}

/** Block UUID casing differs across platforms — always compare case-insensitively. */
export const sameBlockId = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

export interface DisplayBlock extends RecordedBlock {
  /** Current block name when it still exists, else the recorded name. */
  displayName: string;
  /** The block was deleted or renamed away from the vineyard. */
  missingFromVineyard: boolean;
}

export function resolveRecordedBlockNames(
  attribution: RecordedBlockAttribution,
  currentBlocks: { id: string; name?: string | null }[],
): DisplayBlock[] {
  return attribution.blocks.map((b) => {
    const match = currentBlocks.find((c) => sameBlockId(c.id, b.blockId));
    return {
      ...b,
      displayName: match?.name ?? b.recordedName ?? "Unknown block",
      missingFromVineyard: !match,
    };
  });
}

export const BLOCKS_NOT_RECORDED_LABEL = "Blocks not recorded";
