import { useId, useState, type ReactNode } from "react";

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
}

/**
 * Compact tabs for the floating map settings panel. Every tab stays mounted
 * (only hidden) so partially typed fields and table state survive switching.
 */
export default function PanelTabs({ tabs, value, onValueChange, header, footer, label = "Settings" }: Props) {
  const [inner, setInner] = useState(tabs[0]?.id ?? "");
  const active = value ?? inner;
  const set = (id: string) => { if (value === undefined) setInner(id); onValueChange?.(id); };
  const base = useId();
  return (
    <div className="space-y-2">
      <div className="sticky -top-2 z-10 -mx-2 -mt-2 space-y-2 border-b bg-background px-2 pb-2 pt-2">
        {header}
        <div role="tablist" aria-label={label} className="flex gap-1 rounded-md bg-muted p-1">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" id={`${base}-${t.id}-tab`} aria-controls={`${base}-${t.id}`}
              aria-selected={active === t.id} onClick={() => set(t.id)}
              className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${active === t.id ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {t.label}{t.badge}
            </button>
          ))}
        </div>
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`${base}-${t.id}`} aria-labelledby={`${base}-${t.id}-tab`} hidden={active !== t.id} className="space-y-3">
          {t.content}
        </div>
      ))}
      {footer && <div className="sticky -bottom-2 -mx-2 -mb-2 border-t bg-background px-2 py-2">{footer}</div>}
    </div>
  );
}
