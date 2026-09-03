// Generator for the EL Ripeness Heatmap mobile handoff package.
//
// Everything published here is derived from the SHIPPING Portal code
// (`src/lib/growthHeatmap.ts`, `src/lib/vineyardSeasonSettingsQuery.ts`).
// Rule: calculations always use FULL PRECISION values; rounding happens only
// when a number is written to a *_display / rounded field. Rounded values are
// never fed back into a calculation.
import {
  EL_COLOUR_STOPS,
  EL_MAX,
  EL_MIN,
  IDW_POWER,
  RECENCY_HALF_LIFE_DAYS,
  RECENCY_MAX_AGE_DAYS,
  RECENCY_TAPER_DAYS,
  blockHeatMode,
  buildHeatModel,
  daysBetween,
  elColour,
  filterToVintage,
  formatEl,
  heatPoints,
  maxInfluenceDeg,
  medianStage,
  parseElStage,
  pointInPolygon,
  polygonBounds,
  polygonDiagonalDeg,
  recencyWeight,
  sampleHeatAt,
  toObservations,
  type HeatObservation,
} from "@/lib/growthHeatmap";
import {
  seasonRangeForVintage,
  vintageForDate,
} from "@/lib/vineyardSeasonSettingsQuery";

export const CONTRACT_VERSION = "1.1.0";
export const MAX_ALPHA = 0.72;
export const MIN_ALPHA_FACTOR = 0.12;
export const GRID_RESOLUTION = 48;

/** Presentation-only rounding. Never call this before a calculation. */
export const round = (n: number, dp = 6): number =>
  Number.isFinite(n) ? Number(n.toFixed(dp)) : n;

const hex = (c: { r: number; g: number; b: number }) =>
  `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Canvas alpha rule (see `heatCanvas.ts`). */
export function alpha255(weight: number): number {
  return Math.round(255 * MAX_ALPHA * Math.max(MIN_ALPHA_FACTOR, Math.min(1, weight)));
}

export type Fixture = any;

const EL_PARSE_INPUTS: unknown[] = [
  "1", "43", "0", "0.9", "44", "47", "E-L 47", "23", "EL23", "E-L 23", "e l 23",
  "  el 12  ", "E-L23", "23.5", "E-L 23.5", "flowering", "", "  ", "EL", "E-L",
  "23a", "1e1", " 4 3 ", "-5", "43.0000001", "0x1F", null, undefined, 23,
];

const COLOUR_SAMPLE_ELS = [
  1, 2, 6, 6.5, 12, 13, 17, 18, 23, 23.5, 29, 30, 35, 36, 39, 43, 0, 44, 47,
];

const RECENCY_AGES = [0, 1, 7, 14, 21, 42, 63, 69, 70, 71, 77, 83, 83.5, 84, 85, 120, -1];

const VINTAGE_CONFIGS: { m: number; d: number; config: string }[] = [
  { m: 7, d: 1, config: "southern 1 July" },
  { m: 1, d: 1, config: "1 January (Vintage = calendar year, SQL 119)" },
  { m: 11, d: 1, config: "northern 1 Nov" },
];
const VINTAGE_DATES = [
  "2025-06-30", "2025-07-01", "2025-10-31", "2025-11-01", "2025-12-31",
  "2026-01-01", "2026-02-15", "2026-06-30", "2026-07-01", "2026-11-01", "2026-12-31",
];

const localDate = (iso: string) => new Date(`${String(iso).slice(0, 10)}T00:00:00`);

/** Canonical exclusion classification used by the contract. */
export function exclusionReason(o: any, selectedVineyardId: string): string | null {
  if (o.vineyard_id !== selectedVineyardId) return "wrong_vineyard";
  if (o.deleted_at) return "deleted";
  if (parseElStage(o.growth_stage_code) == null) return "el_out_of_range_or_unparseable";
  const lat = o.latitude;
  const lng = o.longitude;
  const bad =
    typeof lat !== "number" || typeof lng !== "number" ||
    !Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0;
  if (bad) return "missing_coordinates";
  if (!(o.date ?? o.completed_at ?? o.created_at)) return "no_observation_date";
  return null;
}

export function buildExpected(fixture: Fixture) {
  const vy = fixture.vineyard;
  const northern = fixture.alternate_vineyards.find((v: any) => v.id === "vy-fixture-north");
  const seasonM = vy.season_start_month;
  const seasonD = vy.season_start_day;

  const ownRecords = fixture.observations.filter((o: any) => o.vineyard_id === vy.id);
  const assignedById = new Map<string, boolean>(
    fixture.observations.map((o: any) => [o.id, !!o.placement?.is_location_assigned]),
  );
  const allObs = toObservations(ownRecords as any, { assignedById });

  const selectedVintage = 2026;
  const season = seasonRangeForVintage(seasonM, seasonD, selectedVintage);
  const seasonObs = filterToVintage(allObs, season.startISO, season.endISO);

  const blocks = fixture.blocks.map((b: any) => ({
    id: b.id,
    name: b.name,
    polygon: b.polygon_points ?? [],
  }));

  const observation_normalisation = fixture.observations.map((o: any) => {
    const reason = exclusionReason(o, vy.id);
    const included = allObs.find((x) => x.id === o.id);
    const vintageSettings =
      o.vineyard_id === vy.id
        ? { m: seasonM, d: seasonD }
        : { m: northern.season_start_month, d: northern.season_start_day };
    const dateISO = o.date ?? o.completed_at ?? o.created_at ?? null;
    return {
      id: o.id,
      vineyard_id: o.vineyard_id,
      parsed_el: parseElStage(o.growth_stage_code),
      excluded_reason: reason,
      included_in_observations: !!included,
      assigned: included ? included.assigned : null,
      resolved_paddock_id: included ? included.paddockId : null,
      season_settings_used: `${vintageSettings.m}/${vintageSettings.d}`,
      vintage: dateISO ? vintageForDate(localDate(dateISO), vintageSettings.m, vintageSettings.d) : null,
      in_selected_season_2026: !!seasonObs.find((x) => x.id === o.id),
    };
  });

  const per_date = fixture.timeline_dates.map((date: string) => {
    const model = buildHeatModel({ observations: seasonObs, blocks, atDateISO: date });
    const blocksOut = model.blocks.map((b) => {
      const bounds = b.polygon.length >= 3 ? polygonBounds(b.polygon) : null;
      const diag = bounds ? polygonDiagonalDeg(bounds) : null;
      const maxInf =
        diag != null && b.influencing.length ? maxInfluenceDeg(diag, b.mode) : null;
      return {
        paddock_id: b.paddockId,
        mode: b.mode,
        observation_ids: b.observations.map((o) => o.id),
        influencing_ids: b.influencing.map((o) => o.id),
        stale_ids: b.stale.map((o) => o.id),
        median_el: b.medianEl,
        median_display: formatEl(b.medianEl),
        polygon_diagonal_deg: diag == null ? null : round(diag),
        max_influence_deg:
          maxInf == null || !Number.isFinite(maxInf) ? null : round(maxInf),
        max_influence_deg_full_precision:
          maxInf == null || !Number.isFinite(maxInf) ? null : maxInf,
        grid_present: !!b.grid,
        grid_resolution: b.grid ? [GRID_RESOLUTION, GRID_RESOLUTION] : null,
        grid_bounds: b.gridBounds,
        recency_weights: b.influencing.map((o) => ({
          id: o.id,
          age_days: daysBetween(o.dateISO, date),
          weight: round(recencyWeight(daysBetween(o.dateISO, date)), 10),
        })),
      };
    });

    const sample_points = fixture.sample_points.map((sp: any) => {
      const block = model.blocks.find((b) => b.paddockId === sp.block)!;
      const inside =
        block.polygon.length >= 3 && pointInPolygon({ lat: sp.lat, lng: sp.lng }, block.polygon);
      if (!inside || !block.influencing.length) {
        return {
          id: sp.id, block: sp.block, lat: sp.lat, lng: sp.lng,
          inside_polygon: inside, idw_el: null, cell_weight: null,
          rgb: null, hex: null, alpha_0_255: 0, alpha_float: 0,
        };
      }
      // FULL PRECISION inputs — never the rounded display radius.
      const diag = polygonDiagonalDeg(polygonBounds(block.polygon));
      const maxInf = maxInfluenceDeg(diag, block.mode);
      const pts = heatPoints(block.influencing, date);
      const s = sampleHeatAt(sp.lat, sp.lng, pts, maxInf);
      if (s.el == null || s.weight == null) {
        return {
          id: sp.id, block: sp.block, lat: sp.lat, lng: sp.lng,
          inside_polygon: true, idw_el: null, cell_weight: null,
          rgb: null, hex: null, alpha_0_255: 0, alpha_float: 0,
        };
      }
      const c = elColour(s.el);
      const a = alpha255(s.weight);
      return {
        id: sp.id, block: sp.block, lat: sp.lat, lng: sp.lng,
        inside_polygon: true,
        idw_el: round(s.el),
        idw_el_full_precision: s.el,
        cell_weight: round(s.weight),
        cell_weight_full_precision: s.weight,
        rgb: c,
        hex: hex(c),
        alpha_0_255: a,
        alpha_float: round(a / 255),
      };
    });

    return {
      date,
      recorded_observations_available: model.qualifying.length,
      influencing_observations: model.influencing.length,
      stale_observations: model.stale.length,
      unassigned_ids: model.unassigned.map((o) => o.id),
      typical_recorded_stage: model.medianEl,
      typical_recorded_stage_display: formatEl(model.medianEl),
      blocks: blocksOut,
      sample_points,
    };
  });

  const isolationDate = "2026-01-25";
  const isoModel = buildHeatModel({ observations: seasonObs, blocks, atDateISO: isolationDate });
  const ids = (p: string) =>
    isoModel.blocks.find((b) => b.paddockId === p)!.influencing.map((o: HeatObservation) => o.id);

  return {
    contract_version: CONTRACT_VERSION,
    fixture_version: fixture.fixture_version,
    precision_policy: {
      calculations: "full IEEE-754 double precision (no intermediate rounding)",
      display_fields:
        "*_display, polygon_diagonal_deg, max_influence_deg, idw_el, cell_weight and alpha_float are rounded for presentation only",
      full_precision_fields:
        "max_influence_deg_full_precision, idw_el_full_precision and cell_weight_full_precision carry the values that actually drove the calculation",
      rule: "rounded values are never fed back into any calculation",
    },
    vintage_authority: {
      source: "database resolve_vintage_year (SQL 119) / mobile shared VintageResolver",
      january_first_rule: "season_start 1 January → Vintage = observation calendar year",
      other_starts: "Vintage = calendar year of the season start + 1",
      hemisphere_field: "none — hemisphere is never used to resolve a Vintage",
    },
    constants: {
      EL_MIN, EL_MAX, IDW_POWER,
      RECENCY_HALF_LIFE_DAYS, RECENCY_MAX_AGE_DAYS, RECENCY_TAPER_DAYS,
      GRID_RESOLUTION, MAX_ALPHA, MIN_ALPHA_FACTOR,
      HALO_FRACTION: 0.22,
      GRADIENT_FRACTION: 0.35,
      ZERO_DISTANCE_EPSILON_D2: 1e-14,
      EL_COLOUR_STOPS: EL_COLOUR_STOPS.map((s) => ({ ...s, hex: hex(s.rgb) })),
    },
    el_parsing: EL_PARSE_INPUTS.map((input) => ({
      input: input === undefined ? "(undefined)" : input,
      parsed: parseElStage(input),
    })),
    colour_scale: COLOUR_SAMPLE_ELS.map((el) => {
      const c = elColour(el);
      return { el, rgb: c, hex: hex(c), css: `rgb(${c.r}, ${c.g}, ${c.b})` };
    }),
    recency: RECENCY_AGES.map((ageDays) => ({
      ageDays,
      weight: round(recencyWeight(ageDays), 10),
    })),
    vintage_assignment: VINTAGE_CONFIGS.flatMap((c) =>
      VINTAGE_DATES.map((date) => ({
        season_start_month: c.m,
        season_start_day: c.d,
        config: c.config,
        date,
        vintage: vintageForDate(localDate(date), c.m, c.d),
      })),
    ),
    season_ranges: [
      { m: 7, d: 1, vintage: 2026 },
      { m: 7, d: 1, vintage: 2027 },
      { m: 1, d: 1, vintage: 2026 },
      { m: 1, d: 1, vintage: 2027 },
      { m: 11, d: 1, vintage: 2026 },
    ].map((r) => ({ ...r, ...seasonRangeForVintage(r.m, r.d, r.vintage) })),
    observation_normalisation,
    block_mode_selection: [
      { influencing: 0, has_polygon: true, total: 0 },
      { influencing: 0, has_polygon: true, total: 3 },
      { influencing: 1, has_polygon: true, total: 1 },
      { influencing: 2, has_polygon: true, total: 2 },
      { influencing: 3, has_polygon: true, total: 3 },
      { influencing: 5, has_polygon: false, total: 5 },
    ].map((c) => ({ ...c, mode: blockHeatMode(c.influencing, c.has_polygon, c.total) })),
    median_cases: [[10, 20, 30, 40], [1, 23, 43], [], [12, 13]].map((values) => ({
      values,
      median: medianStage(values.map((el, i) => ({ el, id: String(i) })) as any),
    })),
    per_date,
    block_isolation: {
      date: isolationDate,
      block_a_influencing_ids: ids("BLOCK_A"),
      block_b_influencing_ids: ids("BLOCK_B"),
      disjoint: ids("BLOCK_A").every((i) => !ids("BLOCK_B").includes(i)),
      note:
        "Block B observations never enter Block A's IDW and vice versa, even 0.00001 deg either side of the shared edge.",
    },
  };
}
