import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface PanelTab { id: string; label: string; badge?: ReactNode; content: ReactNode }

interface Props {
  tabs: PanelTab[];
  /** Controlled value; omit for internal state. */
  value?: string;
  onValueChange?: (id: string) => void;
  /** Always-visible area above the tabs (status, Save). */
  header?: ReactNode;
  /** Always-visible area below the content (Back/Next, Save). */
  footer?: ReactNode;
  label?: string;
  /** Nested sub-tabs: not sticky (avoids overlapping sticky headers), smaller. */
  nested?: boolean;
}

/** Nearest scrollable ancestor (the floating settings panel). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll") return p;
  }
  return null;
}

/**
 * Compact tabs for the floating map settings panel. Every tab stays mounted
 * (only hidden) so partially typed fields and table state survive switching.
 * Any tab change (click, keyboard or programmatic) resets ONLY the settings
 * panel's scroll to the top; the document and map are never scrolled.
 */
export default function PanelTabs({ tabs, value, onValueChange, header, footer, label = "Settings", nested = false }: Props) {
  const [inner, setInner] = useState(tabs[0]?.id ?? "");
  const active = value ?? inner;
  const set = (id: string) => { if (value === undefined) setInner(id); onValueChange?.(id); };
  const base = useId();
  const root = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const btns = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const p = scrollParent(root.current);
    if (p) p.scrollTop = 0;
  }, [active]);

  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (n == null || !tabs.length) return;
    e.preventDefault();
    const t = tabs[(n + tabs.length) % tabs.length];
    set(t.id); btns.current[t.id]?.focus();
  };

  const list = (
    <div role="tablist" aria-label={label} onKeyDown={onKey}
      className={nested
        ? "flex gap-1 rounded-md border bg-muted p-0.5"
        : "flex gap-1 rounded-lg border-2 border-primary/40 bg-primary/10 p-1 shadow-sm"}>
      {tabs.map((t) => {
        const on = active === t.id;
        const tone = nested
          ? on ? "border-primary bg-background text-primary font-semibold shadow-sm" : "border-transparent text-foreground/80 hover:bg-background/70 hover:text-foreground"
          : on ? "border-primary bg-primary text-primary-foreground shadow-md" : "border-border bg-card text-foreground hover:border-primary hover:bg-primary/15";
        return (
          <button key={t.id} ref={(el) => { btns.current[t.id] = el; }} type="button" role="tab" id={`${base}-${t.id}-tab`} aria-controls={`${base}-${t.id}`}
            aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => set(t.id)}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${nested ? "rounded px-1.5 py-1 text-xs font-medium" : "min-h-11 rounded-md px-1.5 text-sm font-bold"} ${tone}`}>
            {t.label}{t.badge}
          </button>
        );
      })}
    </div>
  );
  return (
    <div ref={root} className="space-y-2">
      {nested ? list : (
        <div className="sticky -top-2 z-10 -mx-2 -mt-2 space-y-2 border-b bg-background px-2 pb-2 pt-2">
          {header}
          {list}
        </div>
      )}
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`${base}-${t.id}`} aria-labelledby={`${base}-${t.id}-tab`} hidden={active !== t.id} className="space-y-3">
          {t.content}
        </div>
      ))}
      {footer && <div className="sticky -bottom-2 -mx-2 -mb-2 border-t bg-background px-2 py-2">{footer}</div>}
    </div>
  );
}
