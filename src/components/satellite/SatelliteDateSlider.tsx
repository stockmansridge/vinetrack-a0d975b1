import { useCallback, useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";

export interface SatelliteDateSliderEntry {
  date: string; // YYYY-MM-DD
  coveragePercent: number;
  paddockCount: number;
  activeCount: number;
}

interface Props {
  /** All saved acquisition dates. Any order — sorted ascending internally. */
  entries: SatelliteDateSliderEntry[];
  /** Currently committed date (YYYY-MM-DD). */
  selectedDate: string | null;
  /** Called when the user picks a new date. */
  onChange: (date: string) => void;
  /** Optional total paddock count for the "of N" label when activeCount is 0. */
  totalPaddocks: number;
}

function formatLong(iso: string): string {
  try {
    return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    });
  } catch { return iso; }
}
function formatShort(iso: string): string {
  try {
    return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    });
  } catch { return iso; }
}

export default function SatelliteDateSlider({
  entries, selectedDate, onChange, totalPaddocks,
}: Props) {
  // Sort ascending: oldest -> newest (left -> right on the slider).
  const sorted = useMemo(
    () => [...entries].sort((a, b) => a.date.localeCompare(b.date)),
    [entries],
  );

  const trackRef = useRef<HTMLDivElement | null>(null);
  const count = sorted.length;
  const maxIndex = Math.max(0, count - 1);
  const selectedIndex = useMemo(() => {
    if (!selectedDate) return maxIndex;
    const i = sorted.findIndex((e) => e.date === selectedDate);
    return i >= 0 ? i : maxIndex;
  }, [sorted, selectedDate, maxIndex]);

  const selected = sorted[selectedIndex];

  const commit = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(maxIndex, idx));
    const entry = sorted[clamped];
    if (entry) onChange(entry.date);
  }, [sorted, maxIndex, onChange]);

  // Keyboard: Home / End / arrow keys move by one acquisition date.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (count === 0) return;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        e.preventDefault(); commit(selectedIndex - 1); break;
      case "ArrowRight":
      case "ArrowUp":
        e.preventDefault(); commit(selectedIndex + 1); break;
      case "Home":
        e.preventDefault(); commit(0); break;
      case "End":
        e.preventDefault(); commit(maxIndex); break;
    }
  }, [count, commit, selectedIndex, maxIndex]);

  if (count === 0) {
    return (
      <div className="rounded-md border bg-muted/20 px-3 py-4 text-xs text-muted-foreground">
        No saved crop-health imagery is available yet.
      </div>
    );
  }

  const pctLabel = selected
    ? (Number.isInteger(selected.coveragePercent)
        ? `${selected.coveragePercent}`
        : selected.coveragePercent.toFixed(1))
    : "—";
  const activeCount = selected?.activeCount || totalPaddocks;
  const singleDate = count === 1;

  return (
    <div
      className="rounded-md border bg-background px-3 py-3 md:px-4 md:py-3"
      role="group"
      aria-label="Satellite acquisition date"
    >
      {/* Top row: prev / date / next */}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          disabled={singleDate || selectedIndex <= 0}
          onClick={() => commit(selectedIndex - 1)}
          aria-label="Previous acquisition date"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>

        <div className="min-w-0 flex-1 text-center">
          <div className="text-sm font-semibold text-foreground truncate">
            {selected ? formatLong(selected.date) : "—"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {selected
              ? `${pctLabel}% coverage · ${selected.paddockCount} of ${activeCount} paddocks`
              : ""}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          disabled={singleDate || selectedIndex >= maxIndex}
          onClick={() => commit(selectedIndex + 1)}
          aria-label="Next acquisition date"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Slider + markers */}
      <div
        className="relative mt-2"
        ref={trackRef}
        onKeyDown={onKeyDown}
      >
        <Slider
          className="w-full min-w-0"
          value={[selectedIndex]}
          min={0}
          max={maxIndex}
          step={1}
          disabled={singleDate}
          onValueChange={(v) => {
            const idx = v[0] ?? 0;
            if (idx !== selectedIndex) commit(idx);
          }}
          aria-label="Satellite acquisition date"
          aria-valuetext={selected ? formatLong(selected.date) : undefined}
        />

        {/* Discrete markers overlaid on the track. Purely decorative — the
            slider thumb remains the interactive control. */}
        {!singleDate && (
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2"
            aria-hidden="true"
          >
            {sorted.map((entry, i) => {
              const pct = (i / maxIndex) * 100;
              const isSel = i === selectedIndex;
              const full = entry.paddockCount >= (entry.activeCount || totalPaddocks) && entry.paddockCount > 0;
              const cls = isSel
                ? "h-2.5 w-2.5 bg-primary border-primary"
                : full
                  ? "h-1.5 w-1.5 bg-foreground/70 border-foreground/70"
                  : "h-1.5 w-1.5 bg-background border-foreground/60";
              return (
                <span
                  key={entry.date}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border ${cls}`}
                  style={{ left: `${pct}%`, top: 0 }}
                  title={`${formatShort(entry.date)} — imagery for ${entry.paddockCount} of ${entry.activeCount || totalPaddocks} paddocks`}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Range labels */}
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{formatShort(sorted[0].date)}</span>
        <span>{count} saved date{count === 1 ? "" : "s"}</span>
        <span>{formatShort(sorted[maxIndex].date)}</span>
      </div>
    </div>
  );
}

// Keep hook order stable across renders.
export function _unused() { useEffect(() => {}, []); }
