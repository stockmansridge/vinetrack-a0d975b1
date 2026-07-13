import { useCallback, useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
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
  committedDate: string | null;
  /** Currently previewed date (may equal committed). */
  previewDate?: string | null;
  /** Fires while the user is scrubbing/keyboarding but before commit. */
  onPreviewChange?: (date: string) => void;
  /** Called once the user releases the pointer / finishes a keyboard step. */
  onCommit: (date: string) => void;
  /** Fires when a pointer-drag or keyboard interaction starts. */
  onInteractionStart?: () => void;
  /** Fires when the interaction ends (pointer release / key up). */
  onInteractionEnd?: () => void;
  /** Playback state — when supplied, renders a Play/Pause button. */
  isPlaying?: boolean;
  onTogglePlay?: () => void;
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
  entries,
  committedDate,
  previewDate,
  onPreviewChange,
  onCommit,
  onInteractionStart,
  onInteractionEnd,
  isPlaying = false,
  onTogglePlay,
  totalPaddocks,
}: Props) {
  const sorted = useMemo(
    () => [...entries].sort((a, b) => a.date.localeCompare(b.date)),
    [entries],
  );

  const count = sorted.length;
  const maxIndex = Math.max(0, count - 1);

  const displayDate = previewDate ?? committedDate;
  const displayIndex = useMemo(() => {
    if (!displayDate) return maxIndex;
    const i = sorted.findIndex((e) => e.date === displayDate);
    return i >= 0 ? i : maxIndex;
  }, [sorted, displayDate, maxIndex]);
  const committedIndex = useMemo(() => {
    if (!committedDate) return maxIndex;
    const i = sorted.findIndex((e) => e.date === committedDate);
    return i >= 0 ? i : maxIndex;
  }, [sorted, committedDate, maxIndex]);

  const selected = sorted[displayIndex];
  const draggingRef = useRef(false);

  const preview = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(maxIndex, idx));
    const entry = sorted[clamped];
    if (entry) onPreviewChange?.(entry.date);
  }, [sorted, maxIndex, onPreviewChange]);

  const commit = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(maxIndex, idx));
    const entry = sorted[clamped];
    if (entry) onCommit(entry.date);
  }, [sorted, maxIndex, onCommit]);

  // Keyboard: preview + commit happen together for a single arrow / Home / End.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (count === 0) return;
    const from = displayIndex;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown": next = from - 1; break;
      case "ArrowRight":
      case "ArrowUp": next = from + 1; break;
      case "Home": next = 0; break;
      case "End": next = maxIndex; break;
    }
    if (next == null) return;
    e.preventDefault();
    onInteractionStart?.();
    preview(next);
    commit(next);
    onInteractionEnd?.();
  }, [count, displayIndex, maxIndex, preview, commit, onInteractionStart, onInteractionEnd]);

  // Detect pointer-drag lifecycle so pointer-release triggers commit even
  // though Radix Slider fires onValueChange during move.
  useEffect(() => {
    if (count === 0) return;
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      commit(displayIndex);
      onInteractionEnd?.();
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [count, displayIndex, commit, onInteractionEnd]);

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
  const isPreviewing = previewDate != null && previewDate !== committedDate;

  return (
    <div
      className="rounded-md border bg-background px-3 py-3 md:px-4 md:py-3"
      role="group"
      aria-label="Satellite acquisition date"
    >
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          disabled={singleDate || displayIndex <= 0}
          onClick={() => { onInteractionStart?.(); preview(displayIndex - 1); commit(displayIndex - 1); onInteractionEnd?.(); }}
          aria-label="Previous acquisition date"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>

        <div className="min-w-0 flex-1 text-center">
          <div className="text-sm font-semibold text-foreground truncate">
            {selected ? formatLong(selected.date) : "—"}
            {isPreviewing && (
              <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">Preview</span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {selected
              ? `${pctLabel}% coverage · ${selected.paddockCount} of ${activeCount} paddocks`
              : ""}
          </div>
        </div>

        {onTogglePlay && (
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            disabled={singleDate}
            onClick={onTogglePlay}
            aria-label={isPlaying ? "Pause timeline playback" : "Play timeline"}
            aria-pressed={isPlaying}
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          disabled={singleDate || displayIndex >= maxIndex}
          onClick={() => { onInteractionStart?.(); preview(displayIndex + 1); commit(displayIndex + 1); onInteractionEnd?.(); }}
          aria-label="Next acquisition date"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      <div className="relative mt-2" onKeyDown={onKeyDown}>
        <Slider
          className="w-full min-w-0"
          value={[displayIndex]}
          min={0}
          max={maxIndex}
          step={1}
          disabled={singleDate}
          onPointerDown={() => {
            draggingRef.current = true;
            onInteractionStart?.();
          }}
          onValueChange={(v) => {
            const idx = v[0] ?? 0;
            if (idx === displayIndex) return;
            if (draggingRef.current) preview(idx);
            else { preview(idx); commit(idx); }
          }}
          aria-label="Satellite acquisition date"
          aria-valuetext={selected ? formatLong(selected.date) : undefined}
        />

        {!singleDate && (
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2"
            aria-hidden="true"
          >
            {sorted.map((entry, i) => {
              const pct = (i / maxIndex) * 100;
              const isSel = i === displayIndex;
              const isCommitted = i === committedIndex;
              const full = entry.paddockCount >= (entry.activeCount || totalPaddocks) && entry.paddockCount > 0;
              const cls = isSel
                ? "h-2.5 w-2.5 bg-primary border-primary"
                : isCommitted
                  ? "h-2 w-2 bg-primary/60 border-primary/60"
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

      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{formatShort(sorted[0].date)}</span>
        <span>{count} saved date{count === 1 ? "" : "s"}</span>
        <span>{formatShort(sorted[maxIndex].date)}</span>
      </div>
    </div>
  );
}
