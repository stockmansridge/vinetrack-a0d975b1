import { useMemo, useState } from "react";
import { useVintage } from "@/lib/useVintage";
import {
  vintageOptions,
  vintageScope,
  type VintageScope,
} from "@/lib/vintageScope";

export interface VintageFilter {
  /** The Vintage currently in effect (defaults to the vineyard's current). */
  vintage: number;
  setVintage: (v: number) => void;
  /** Current Vintage + previous 15. */
  options: number[];
  /** Canonical season window for the selected Vintage. */
  scope: VintageScope;
  /** True while the vineyard's season settings are still resolving. */
  isLoading: boolean;
}

/**
 * Standard Vintage filter state for a dated list, report, chart or export.
 * Defaults to the current vineyard Vintage and always resolves the season
 * window from the canonical season settings — never from calendar years.
 */
export function useVintageFilter(): VintageFilter {
  const { vintage, seasonStartMonth, seasonStartDay, isLoading } = useVintage();
  const [selected, setSelected] = useState<number | null>(null);
  const active = selected ?? vintage;

  const scope = useMemo(
    () => vintageScope(active, seasonStartMonth, seasonStartDay),
    [active, seasonStartMonth, seasonStartDay],
  );

  const options = useMemo(() => {
    const list = vintageOptions(vintage);
    // Keep an explicitly selected Vintage selectable even if the anchor moves.
    return list.includes(active) ? list : [active, ...list].sort((a, b) => b - a);
  }, [vintage, active]);

  return { vintage: active, setVintage: setSelected, options, scope, isLoading };
}
