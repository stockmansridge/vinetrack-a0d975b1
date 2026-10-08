// Manual Machine Work auto-costing (Work Task machine lines).
//
// Rules:
//   hours basis   = engine hours used when supplied (non-blank finite ≥ 0),
//                   otherwise duration hours.
//   fuel litres   = hours basis × configured equipment L/hr
//                   (tractors / vineyard_machines.fuel_usage_l_per_hour;
//                   NULL or ≤ 0 = not configured, per SQL 209 convention).
//   fuel cost     = fuel litres × vineyard weighted fuel price
//                   (fuel_purchases, same source as GPS-trip costing).
//   machine charge= duration (or engine hours if no duration) × hourly
//                   machine rate. No equipment table stores a rate, so the
//                   rate is the line's own hourly_machine_rate; blank = no
//                   charge (not $0), explicit 0 = $0.
//   total_machine_cost stores the machine CHARGE only; the cost roll-up adds
//   fuel_cost on top, so fuel is never counted twice. If the hourly rate
//   already includes fuel, enter Fuel cost = 0 as an override.
//   Overrides: a saved value that differs from what auto would produce is a
//   durable manual override and is never overwritten. Clearing a field
//   returns it to auto.

export type AutoField = "fuel_litres" | "fuel_cost" | "total_machine_cost";

export interface MachineCostInputs {
  duration_hours: string;
  engine_hours_used: string;
  hourly_machine_rate: string;
}

export interface MachineCostConfig {
  /** Configured equipment fuel usage (L/hr); null when not configured. */
  litresPerHour: number | null;
  /** Vineyard fuel price ($/L); null when unavailable. */
  fuelPricePerLitre: number | null;
}

export interface MachineCostAuto {
  fuel_litres: number | null;
  fuel_cost: number | null;
  total_machine_cost: number | null;
  missing: string[];
}

export const parseField = (s: string | null | undefined): number | null => {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

export function validRate(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function computeMachineLineAuto(
  inputs: MachineCostInputs,
  config: MachineCostConfig,
): MachineCostAuto {
  const missing: string[] = [];
  const dur = parseField(inputs.duration_hours);
  const eng = parseField(inputs.engine_hours_used);
  const fuelHours = eng ?? dur;
  const chargeHours = dur ?? eng;
  const lph = validRate(config.litresPerHour);
  const price = validRate(config.fuelPricePerLitre);

  let fuel_litres: number | null = null;
  if (lph == null) missing.push("Equipment fuel usage (L/hr) not configured");
  else if (fuelHours != null) fuel_litres = round(fuelHours * lph, 2);

  let fuel_cost: number | null = null;
  if (fuel_litres != null) {
    if (price == null) missing.push("No fuel purchases on file — fuel price unavailable");
    else fuel_cost = round(fuel_litres * price, 2);
  }

  const rate = parseField(inputs.hourly_machine_rate);
  const total_machine_cost =
    rate != null && chargeHours != null ? round(chargeHours * rate, 2) : null;

  return { fuel_litres, fuel_cost, total_machine_cost, missing };
}

export const autoToString = (n: number | null): string => (n == null ? "" : String(n));

/** A saved value is a manual override when it is set and differs from auto. */
export function isOverride(saved: string, auto: number | null): boolean {
  const s = parseField(saved);
  if (String(saved ?? "").trim() === "") return false;
  if (s == null) return true;
  if (auto == null) return true;
  return Math.abs(s - auto) > 0.005;
}

/** Equipment L/hr lookup for the selected source/ref. */
export function equipmentLitresPerHour(
  source: string,
  refId: string | null,
  lookups: {
    machines: ReadonlyArray<{ id: string; fuel_usage_l_per_hour?: number | null; legacy_tractor_id?: string | null }>;
    tractors: ReadonlyArray<{ id: string; fuel_usage_l_per_hour?: number | null }>;
  },
): number | null {
  if (!refId) return null;
  if (source === "vineyard_machine") {
    const m = lookups.machines.find((r) => r.id === refId);
    const own = validRate(m?.fuel_usage_l_per_hour);
    if (own != null) return own;
    if (m?.legacy_tractor_id)
      return validRate(lookups.tractors.find((t) => t.id === m.legacy_tractor_id)?.fuel_usage_l_per_hour);
    return null;
  }
  if (source === "tractor") {
    const own = validRate(lookups.tractors.find((t) => t.id === refId)?.fuel_usage_l_per_hour);
    if (own != null) return own;
    return validRate(
      lookups.machines.find((m) => m.legacy_tractor_id === refId)?.fuel_usage_l_per_hour,
    );
  }
  return null;
}
