import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useNavViewer } from "@/hooks/useNavViewer";
import { searchDestinations, type SearchDestination } from "@/lib/navigationConfig";

export function GlobalSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const navigate = useNavigate();
  const viewer = useNavViewer();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const visibleItems = useMemo(() => searchDestinations(viewer), [viewer]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as SearchDestination[];
    return visibleItems
      .map((item) => {
        const hay = [item.title, item.group, ...item.keywords].join(" ").toLowerCase();
        const idx = hay.indexOf(q);
        if (idx === -1) return null;
        const titleIdx = item.title.toLowerCase().indexOf(q);
        const score = titleIdx === 0 ? 0 : titleIdx > -1 ? 1 : 2 + idx;
        return { item, score };
      })
      .filter((x): x is { item: SearchDestination; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 12)
      .map((x) => x.item);
  }, [query, visibleItems]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const go = (url: string) => {
    setOpen(false);
    setQuery("");
    navigate(url);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (results[activeIdx]) {
        e.preventDefault();
        go(results[activeIdx].path);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        value={query}
        aria-label="Search pages and reports"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        placeholder="Search settings, pages, reports…"
        className="pl-9 pr-4 h-9 rounded-full bg-background border border-input shadow-sm focus-visible:bg-card focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
      />
      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg overflow-hidden">
          {results.length === 0 ? (
            <div className="px-3 py-6 text-sm text-muted-foreground text-center">
              No matches for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {results.map((item, idx) => (
                <li key={`${item.group}:${item.path}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIdx(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      go(item.path);
                    }}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                      idx === activeIdx ? "bg-accent text-accent-foreground" : ""
                    }`}
                  >
                    <span className="truncate">{item.title}</span>
                    <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground shrink-0">
                      {item.group}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
