// E-L development phases for the Growth Stage Heatmap.
//
// Presentation/derived logic only — no data source, no writes. Each phase has
// its OWN red → green scale: the first stage of the phase is red, the final
// stage of the phase is green. This replaces the single fixed E-L 1–43 scale
// for the heatmap surface, pins and legend.

import type { RGB } from "@/lib/growthHeatmap";

export interface ElPhase {
  id: string;
  label: string;
  min: number;
  max: number;
}

export const EL_PHASES: ElPhase[] = [
  { id: "shoot", label: "Shoot and inflorescence development", min: 1, max: 18 },
  { id: "flowering", label: "Flowering", min: 19, max: 26 },
  { id: "berry_formation", label: "Berry formation", min: 27, max: 33 },
  { id: "berry_ripening", label: "Berry ripening", min: 34, max: 39 },
  { id: "senescence", label: "Senescence", min: 41, max: 47 },
];

export const phaseOptionLabel = (p: ElPhase) => `${p.label} — E-L ${p.min}–${p.max}`;

export const phaseById = (id: string | null | undefined): ElPhase | null =>
  EL_PHASES.find((p) => p.id === id) ?? null;

export const elInPhase = (el: number, phase: ElPhase): boolean =>
  el >= phase.min && el <= phase.max;

/**
 * Phase containing this E-L value. Values that fall in a gap between
 * documented phases (e.g. E-L 40) resolve to the nearest phase so an
 * observation is never silently unreachable.
 */
export function phaseForEl(el: number): ElPhase {
  const exact = EL_PHASES.find((p) => elInPhase(el, p));
  if (exact) return exact;
  let best = EL_PHASES[0];
  let bestDist = Infinity;
  for (const p of EL_PHASES) {
    const d = el < p.min ? p.min - el : el > p.max ? el - p.max : 0;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** Red → amber → green ramp used inside every phase. */
export const PHASE_RAMP: RGB[] = [
  { r: 220, g: 38, b: 38 },
  { r: 234, g: 179, b: 8 },
  { r: 22, g: 143, b: 60 },
];

/** Position of an E-L value inside its phase, 0 (first stage) → 1 (final). */
export function phaseProgress(el: number, phase: ElPhase): number {
  const span = phase.max - phase.min;
  if (span <= 0) return 0;
  return clamp((el - phase.min) / span, 0, 1);
}

/** Phase-relative colour: first stage red, final stage green. */
export function phaseColour(el: number, phase: ElPhase): RGB {
  const t = phaseProgress(el, phase);
  const segs = PHASE_RAMP.length - 1;
  const pos = t * segs;
  const i = Math.min(segs - 1, Math.floor(pos));
  const local = pos - i;
  const a = PHASE_RAMP[i];
  const b = PHASE_RAMP[i + 1];
  return { r: mix(a.r, b.r, local), g: mix(a.g, b.g, local), b: mix(a.b, b.b, local) };
}

export const phaseColourCss = (el: number, phase: ElPhase) => {
  const c = phaseColour(el, phase);
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
};

export const makePhaseColour = (phase: ElPhase) => (el: number) => phaseColour(el, phase);
export const makePhaseColourCss = (phase: ElPhase) => (el: number) => phaseColourCss(el, phase);
