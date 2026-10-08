import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Maximize, Minimize, Scan, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  settings: ReactNode;
  onFit: () => void;
  title?: string;
  /** When this changes to a new non-null value, open the settings panel and scroll its own contents to the top. */
  revealKey?: string | null;
}

/** One map instance, including when the workspace escapes AppLayout's stacking context. */
export default function RowMapWorkspace({ children, settings, onFit, title = "Row setup", revealKey = null }: Props) {
  const anchor = useRef<HTMLDivElement>(null);
  const [host] = useState(() => document.createElement("div"));
  const [fullScreen, setFullScreen] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const panelId = useId();
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (revealKey == null) return;
    setShowSettings(true);
    // Scroll only the panel (never the document); runs once per new key.
    const frame = requestAnimationFrame(() => { if (panel.current) panel.current.scrollTop = 0; });
    return () => cancelAnimationFrame(frame);
  }, [revealKey]);

  // Move the same portal host instead of changing portal targets/remounting the map.
  // z-40 covers the app header; Radix dialogs/menus at z-50 still appear above it.
  useLayoutEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    const restoreFocus = focused && host.contains(focused);
    host.className = fullScreen ? "fixed inset-0 z-40 bg-background" : "relative h-full w-full";
    (fullScreen ? document.body : anchor.current)?.appendChild(host);
    if (restoreFocus) focused.focus({ preventScroll: true });
    // MapKit observes window resize; Leaflet also has a container ResizeObserver.
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return () => cancelAnimationFrame(frame);
  }, [fullScreen, host]);

  useLayoutEffect(() => () => { host.remove(); }, [host]);

  useLayoutEffect(() => {
    if (!fullScreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Let the active dialog, select or popover consume its own Escape first.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper]')) return;
      e.preventDefault();
      setFullScreen(false);
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", escape, true);
    };
  }, [fullScreen]);

  return (
    <div ref={anchor} className="h-[max(640px,calc(100dvh-12rem))] w-full" data-row-map-anchor>
      {createPortal(
        <section aria-label={`${title} map workspace`} data-full-screen={fullScreen}
          className={`relative isolate h-full w-full overflow-hidden bg-muted ${fullScreen ? "" : "rounded-lg border"}`}>
          <div className="absolute inset-0 z-0">{children}</div>
          <div className="absolute left-3 top-3 z-20 flex gap-2">
            <Button type="button" size="sm" variant="secondary" className="gap-1 shadow" onClick={onFit}
              aria-label="Fit to block" title="Fit to block">
              <Scan className="h-4 w-4" /> <span className="hidden sm:inline">Fit to block</span>
            </Button>
            <Button type="button" size="sm" variant="secondary" className="gap-1 shadow"
              aria-label={fullScreen ? "Exit full screen" : "Full screen"} title={fullScreen ? "Exit full screen (Esc)" : "Full screen"}
              onClick={() => setFullScreen((v) => !v)}>
              {fullScreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              <span className="hidden sm:inline">{fullScreen ? "Exit full screen" : "Full screen"}</span>
            </Button>
          </div>
          <Button type="button" size="sm" variant="secondary" className="absolute right-3 top-3 z-20 gap-1 shadow"
            aria-controls={panelId} aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)}>
            {showSettings ? <X className="h-4 w-4" /> : <Settings2 className="h-4 w-4" />}
            {showSettings ? "Hide settings" : "Show settings"}
          </Button>
          {/* Keep fields mounted, including partially typed numbers and table state. */}
          <aside ref={panel} id={panelId} aria-label={`${title} settings`} hidden={!showSettings}
            className="absolute bottom-11 left-3 right-3 z-10 max-h-[45%] overflow-auto overscroll-contain rounded-lg border bg-background p-2 shadow-xl md:left-auto md:top-14 md:max-h-none md:w-[380px] md:max-w-[calc(100%-6rem)]"
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
            <div className="space-y-3">{settings}</div>
          </aside>
        </section>, host,
      )}
    </div>
  );
}
