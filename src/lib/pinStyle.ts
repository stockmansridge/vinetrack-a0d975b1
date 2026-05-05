// Pin mode → color mapping (per task spec)
// Repair=red/orange, Growth=green, Note=blue, Hazard=yellow, Spray=purple
export interface PinStyle {
  hex: string;
  label: string;
}

const STYLES: Record<string, PinStyle> = {
  repair: { hex: "#FF6A00", label: "Repair" },
  repairs: { hex: "#FF6A00", label: "Repair" },
  growth: { hex: "#34C759", label: "Growth" },
  note: { hex: "#3B82F6", label: "Note" },
  notes: { hex: "#3B82F6", label: "Note" },
  hazard: { hex: "#F5C518", label: "Hazard" },
  spray: { hex: "#A855F7", label: "Spray" },
};

const DEFAULT_STYLE: PinStyle = { hex: "#64748B", label: "Other" };

export function pinStyle(mode?: string | null): PinStyle {
  if (!mode) return DEFAULT_STYLE;
  return STYLES[mode.toLowerCase()] ?? DEFAULT_STYLE;
}
