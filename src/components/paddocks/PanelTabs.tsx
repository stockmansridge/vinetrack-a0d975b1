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
    <div role="tablist" aria-label={label} onKeyDown={onKey} className={`flex gap-1 rounded-md bg-muted p-1 ${nested ? "p-0.5" : ""}`}>
      {tabs.map((t) => (
        <button key={t.id} ref={(el) => { btns.current[t.id] = el; }} type="button" role="tab" id={`${base}-${t.id}-tab`} aria-controls={`${base}-${t.id}`}
          aria-selected={active === t.id} tabIndex={active === t.id ? 0 : -1} onClick={() => set(t.id)}
          className={`flex flex-1 items-center justify-center gap-1 rounded px-2 ${nested ? "py-0.5 text-[11px]" : "py-1 text-xs"} font-medium transition-colors ${active === t.id ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          {t.label}{t.badge}
        </button>
      ))}
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
