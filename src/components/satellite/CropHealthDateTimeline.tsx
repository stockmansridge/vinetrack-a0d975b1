// Historical imagery timeline for Crop Health Maps.
//
// Bottom-docked, full-width bar (no floating card). Shows EVERY known capture
// date on one horizontal rail — dates with saved imagery, dates still
// downloading or processing, and dates the provider could not deliver (cloud,
// no capture, failed) — so growers can see the whole imagery history and jump
// straight to any usable date.
//
// Heights: ~84 px expanded, ~44 px collapsed. Secondary counts live in the
// compact details line and in per-node tooltips.
//
// Presentation only: statuses are supplied by the page (saved manifest dates
// merged with backfill expected-date outcomes).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  CircleDashed, CloudOff, Loader2, Minus, Pause, Play, SkipBack, SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type TimelineStatus =
  | "available"     // imagery saved for every scoped paddock
  | "partial"       // imagery saved for some paddocks
  | "processing"    // downloading / processing right now
  | "queued"        // known date, not checked yet
  | "cloud"         // cloud or shadow — unusable
  | "no_capture"    // provider never captured this date
  | "failed";       // attempted and failed

export interface TimelineDateEntry {
  date: string;             // YYYY-MM-DD
  status: TimelineStatus;
  paddockCount: number;     // paddocks with imagery on this date
  activeCount: number;      // paddocks in scope
  coveragePercent: number;
  note?: string | null;
}

interface Props {
  entries: TimelineDateEntry[];
  committedDate: string | null;
  previewDate?: string | null;
  onPreviewChange?: (date: string) => void;
  onCommit: (date: string) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  totalPaddocks: number;
  singlePaddockScope?: boolean;
  scopedPaddockMissing?: boolean;
  layerShortLabel?: string;
  /** e.g. "Sentinel-2" — shown in the compact details line. */
  sourceLabel?: string;
}

const STATUS_META: Record<TimelineStatus, {
  label: string;
  icon: typeof Check;
  dot: string;      // node styling
  text: string;     // legend text colour
  selectable: boolean;
}> = {
  available:  { label: "Imagery available", icon: Check,        dot: "bg-primary border-primary text-primary-foreground", text: "text-primary", selectable: true },
  partial:    { label: "Partial coverage",  icon: Minus,        dot: "bg-primary/35 border-primary text-primary", text: "text-primary", selectable: true },
  processing: { label: "Processing",        icon: Loader2,      dot: "bg-background border-warning text-warning", text: "text-warning", selectable: false },
  queued:     { label: "Not checked yet",   icon: CircleDashed, dot: "bg-background border-muted-foreground/50 text-muted-foreground", text: "text-muted-foreground", selectable: false },
  cloud:      { label: "Cloud or shadow",   icon: CloudOff,     dot: "bg-muted border-muted-foreground/40 text-muted-foreground", text: "text-muted-foreground", selectable: false },
  no_capture: { label: "No capture",        icon: Minus,        dot: "bg-muted border-muted-foreground/30 text-muted-foreground", text: "text-muted-foreground", selectable: false },
  failed:     { label: "Failed",            icon: AlertTriangle,dot: "bg-background border-destructive text-destructive", text: "text-destructive", selectable: false },
};

function formatLong(iso: string): string {
  try {
    return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    });
  } catch { return iso; }
}
function formatMedium(iso: string): string {
  try {
    return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    });
  } catch { return iso; }
}
function formatShort(iso: string): string {
  try {
    return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
      day: "numeric", month: "short", timeZone: "UTC",
    });
  } catch { return iso; }
}
function yearOf(iso: string): string { return iso.slice(0, 4); }

const STORAGE_KEY = "crop-health:timeline-collapsed";

export default function CropHealthDateTimeline({
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
  singlePaddockScope = false,
  scopedPaddockMissing = false,
  layerShortLabel,
  sourceLabel = "Sentinel-2",
}: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });
  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Oldest → newest, left → right.
  const sorted = useMemo(
    () => [...entries].sort((a, b) => a.date.localeCompare(b.date)),
    [entries],
  );
  const selectable = useMemo(
    () => sorted.filter((e) => STATUS_META[e.status]?.selectable),
    [sorted],
  );

  const displayDate = previewDate ?? committedDate;
  const selected = useMemo(
    () => sorted.find((e) => e.date === displayDate) ?? null,
    [sorted, displayDate],
  );
  const selectableIndex = useMemo(
    () => selectable.findIndex((e) => e.date === displayDate),
    [selectable, displayDate],
  );

  const go = useCallback((idx: number) => {
    const entry = selectable[Math.max(0, Math.min(selectable.length - 1, idx))];
    if (!entry) return;
    onInteractionStart?.();
    onPreviewChange?.(entry.date);
    onCommit(entry.date);
    onInteractionEnd?.();
  }, [selectable, onCommit, onPreviewChange, onInteractionStart, onInteractionEnd]);

  const pick = useCallback((entry: TimelineDateEntry) => {
    if (!STATUS_META[entry.status]?.selectable) return;
    onInteractionStart?.();
    onPreviewChange?.(entry.date);
    onCommit(entry.date);
    onInteractionEnd?.();
  }, [onCommit, onPreviewChange, onInteractionStart, onInteractionEnd]);

  // Keep the active date visible as the selection moves (playback, arrows).
  useEffect(() => {
    if (!displayDate || collapsed) return;
    const el = railRef.current?.querySelector<HTMLElement>(`[data-date="${displayDate}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [displayDate, collapsed]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (selectable.length === 0) return;
    const from = selectableIndex >= 0 ? selectableIndex : selectable.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = from - 1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = from + 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = selectable.length - 1;
    if (next == null) return;
    e.preventDefault();
    go(next);
  }, [selectable, selectableIndex, go]);

  if (sorted.length === 0) {
    return (
      <div
        className="flex h-11 w-full items-center gap-2 border-t bg-background/95 px-3 text-xs text-muted-foreground backdrop-blur"
        role="status"
        aria-live="polite"
      >
        <span className="font-medium text-foreground">No crop-health imagery history yet.</span>
        <span className="hidden sm:inline">Check for new imagery to look for a suitable Copernicus capture.</span>
      </div>
    );
  }

  const savedCount = sorted.filter((e) => e.status === "available" || e.status === "partial").length;
  const unusable = sorted.filter((e) => e.status === "cloud" || e.status === "no_capture" || e.status === "failed").length;
  const busy = sorted.filter((e) => e.status === "processing" || e.status === "queued").length;
  const isPreviewing = previewDate != null && previewDate !== committedDate;

  const coverageSummary = (() => {
    if (!selected) return "Select a date with imagery";
    if (singlePaddockScope) {
      if (scopedPaddockMissing) {
        const layerName = layerShortLabel ? `${layerShortLabel} ` : "";
        return `No saved ${layerName}imagery for this paddock`;
      }
      return "1/1 paddock";
    }
    const total = selected.activeCount || totalPaddocks;
    const meta = STATUS_META[selected.status];
    if (!meta?.selectable) return meta?.label ?? "";
    return `${selected.paddockCount}/${total} paddock${total === 1 ? "" : "s"}`;
  })();

  const atOldest = selectable.length < 2 || selectableIndex <= 0;
  const atNewest = selectable.length < 2 || selectableIndex >= selectable.length - 1;

  const collapseButton = (
    <Button
      variant="ghost" size="icon" className="h-8 w-8 shrink-0"
      onClick={toggleCollapsed}
      aria-label={collapsed ? "Expand imagery timeline" : "Collapse imagery timeline"}
      aria-expanded={!collapsed}
    >
      {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
    </Button>
  );

  if (collapsed) {
    return (
      <div
        className="flex h-11 w-full items-center gap-1 border-t bg-background/95 px-2 backdrop-blur"
        role="group"
        aria-label="Crop health imagery timeline (collapsed)"
      >
        <Button
          variant="ghost" size="icon" className="h-8 w-8 shrink-0"
          disabled={atOldest} onClick={() => go(selectableIndex - 1)}
          aria-label="Previous available date"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1 truncate text-xs">
          <span className="font-semibold text-foreground">{selected ? formatMedium(selected.date) : "—"}</span>
          <span className="text-muted-foreground">
            {" · "}{coverageSummary}
            {layerShortLabel ? ` · ${layerShortLabel}` : ""}
          </span>
        </div>
        <Button
          variant="ghost" size="icon" className="h-8 w-8 shrink-0"
          disabled={atNewest} onClick={() => go(selectableIndex + 1)}
          aria-label="Next available date"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost" size="icon" className="h-8 w-8 shrink-0"
          disabled={atNewest} onClick={() => go(selectable.length - 1)}
          aria-label="Jump to newest available imagery"
        >
          <SkipForward className="h-4 w-4" />
        </Button>
        {collapseButton}
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className="w-full border-t bg-background/95 backdrop-blur"
        role="group"
        aria-label="Crop health imagery timeline"
      >
        {/* Rail row */}
        <div className="flex h-[52px] items-center gap-0.5 px-1">
          <Button
            variant="ghost" size="icon" className="h-8 w-8 shrink-0"
            disabled={atOldest} onClick={() => go(0)}
            aria-label="Jump to oldest available imagery"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-8 w-8 shrink-0"
            disabled={atOldest} onClick={() => go(selectableIndex - 1)}
            aria-label="Previous available date"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div
            ref={railRef}
            className="relative min-w-0 flex-1 overflow-x-auto overscroll-x-contain"
            tabIndex={0}
            onKeyDown={onKeyDown}
            role="listbox"
            aria-label="Imagery capture dates"
            aria-activedescendant={displayDate ? `timeline-${displayDate}` : undefined}
          >
            <div className="relative flex min-w-full items-center gap-0.5 px-1">
              {/* Continuous rail line behind the nodes */}
              <div className="pointer-events-none absolute left-0 right-0 top-[15px] h-px bg-border" aria-hidden="true" />
              {sorted.map((entry, i) => {
                const meta = STATUS_META[entry.status] ?? STATUS_META.queued;
                const Icon = meta.icon;
                const isSel = entry.date === displayDate;
                const isCommitted = entry.date === committedDate;
                const showYear = i === 0 || yearOf(sorted[i - 1].date) !== yearOf(entry.date);
                const total = entry.activeCount || totalPaddocks;
                const detail = meta.selectable
                  ? `${entry.paddockCount} of ${total} paddocks`
                  : meta.label;
                return (
                  <Tooltip key={entry.date}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        id={`timeline-${entry.date}`}
                        data-date={entry.date}
                        role="option"
                        aria-selected={isSel}
                        disabled={!meta.selectable}
                        onClick={() => pick(entry)}
                        className={`relative z-10 flex w-10 shrink-0 flex-col items-center gap-0.5 rounded py-0.5 transition-colors ${
                          meta.selectable ? "cursor-pointer hover:bg-accent" : "cursor-default"
                        } ${isSel ? "bg-accent" : ""}`}
                      >
                        <span
                          className={`flex items-center justify-center rounded-full border ${meta.dot} ${
                            isSel ? "h-5 w-5 ring-2 ring-ring ring-offset-1 ring-offset-background"
                                  : isCommitted ? "h-4 w-4" : "h-3.5 w-3.5"
                          }`}
                        >
                          <Icon className={`${isSel ? "h-3 w-3" : "h-2 w-2"} ${entry.status === "processing" ? "animate-spin" : ""}`} />
                        </span>
                        <span className={`whitespace-nowrap text-[10px] leading-tight ${isSel ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                          {formatShort(entry.date)}
                        </span>
                        {showYear && (
                          <span className="text-[9px] leading-none text-muted-foreground/70">{yearOf(entry.date)}</span>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <div className="font-medium">{formatLong(entry.date)}</div>
                      <div className={meta.text}>{meta.label}</div>
                      <div className="text-muted-foreground">{detail}</div>
                      {entry.note && <div className="text-muted-foreground">{entry.note}</div>}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>

          <Button
            variant="ghost" size="icon" className="h-8 w-8 shrink-0"
            disabled={atNewest} onClick={() => go(selectableIndex + 1)}
            aria-label="Next available date"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-8 w-8 shrink-0"
            disabled={atNewest} onClick={() => go(selectable.length - 1)}
            aria-label="Jump to newest available imagery"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          {onTogglePlay && (
            <Button
              variant="ghost" size="icon" className="h-8 w-8 shrink-0"
              disabled={selectable.length < 2}
              onClick={onTogglePlay}
              aria-label={isPlaying ? "Pause timeline playback" : "Play timeline"}
              aria-pressed={isPlaying}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          )}
          {collapseButton}
        </div>

        {/* Compact details line */}
        <div className="flex h-7 items-center justify-between gap-3 border-t px-3 text-[11px] text-muted-foreground">
          <div className="min-w-0 truncate" aria-live="polite">
            <span className="text-muted-foreground">Selected: </span>
            <span className="font-medium text-foreground">{selected ? formatLong(selected.date) : "—"}</span>
            <span>
              {" · "}{coverageSummary}
              {layerShortLabel ? ` · ${layerShortLabel}` : ""}
              {sourceLabel ? ` · ${sourceLabel}` : ""}
            </span>
            {isPreviewing && (
              <span className="ml-2 uppercase tracking-wide">Preview</span>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="hidden shrink-0 items-center gap-3 sm:flex">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                  {savedCount}
                </span>
                {busy > 0 && (
                  <span className="inline-flex items-center gap-1 text-warning">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    {busy}
                  </span>
                )}
                {unusable > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <CloudOff className="h-3 w-3" aria-hidden="true" />
                    {unusable}
                  </span>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <div>{savedCount} date{savedCount === 1 ? "" : "s"} with imagery</div>
              {busy > 0 && <div>{busy} in progress</div>}
              {unusable > 0 && <div>{unusable} unavailable (cloud or no capture)</div>}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
