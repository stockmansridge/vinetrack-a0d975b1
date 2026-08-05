// Reusable wide-report table container with a synchronised horizontal
// scrollbar above the table, so users never have to scroll to the bottom of a
// long table to reach the browser's own scrollbar.
//
// Structure:
//   [ top scrollbar proxy ]   <- only rendered when the content overflows
//   [ scrollable table area ] <- the real scroller (wheel, trackpad, touch)
//
// Both scrollers share one horizontal offset; there is only ever one table
// body, so headers and cells stay aligned.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  className?: string;
  /** Sticky offset for the top scrollbar, in px, below the portal header. */
  stickyTopPx?: number;
}

export function SynchronisedHorizontalScroll({ children, className, stickyTopPx = 0 }: Props) {
  const topRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [overflows, setOverflows] = useState(false);

  const measure = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    setScrollWidth(el.scrollWidth);
    setOverflows(el.scrollWidth > el.clientWidth + 1);
  }, []);

  useLayoutEffect(() => { measure(); });

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    Array.from(el.children).forEach((c) => ro.observe(c));
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [measure]);

  const mirror = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => { syncing.current = false; });
  };

  return (
    <div className={cn("relative", className)}>
      {overflows && (
        <div
          ref={topRef}
          onScroll={() => mirror(topRef.current, bodyRef.current)}
          className="sticky z-20 overflow-x-auto overflow-y-hidden bg-background/95 backdrop-blur rounded-t-lg border-b"
          style={{ top: stickyTopPx }}
          aria-hidden
        >
          <div style={{ width: scrollWidth, height: 1 }} />
        </div>
      )}
      <div
        ref={bodyRef}
        onScroll={() => mirror(bodyRef.current, topRef.current)}
        className="overflow-x-auto"
      >
        {children}
      </div>
    </div>
  );
}

export default SynchronisedHorizontalScroll;
