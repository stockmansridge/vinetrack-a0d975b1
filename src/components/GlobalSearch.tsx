import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useVineyard } from "@/context/VineyardContext";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { canAccessRoute } from "@/lib/rolePermissions";

type SearchItem = {
  title: string;
  url: string;
  group: string;
  keywords?: string[];
  adminOnly?: boolean;
  systemAdminOnly?: boolean;
};

const ITEMS: SearchItem[] = [
  // Dashboard
  { title: "Overview", url: "/dashboard", group: "Dashboard", keywords: ["home", "summary"] },
  { title: "Live Dashboard", url: "/dashboard/live", group: "Dashboard", keywords: ["live", "realtime", "weather"] },

  // Work
  { title: "Spray Jobs & Templates", url: "/spray-jobs", group: "Work", keywords: ["spray", "chemicals", "templates", "program"] },
  { title: "Work Tasks", url: "/work-tasks", group: "Work", keywords: ["tasks", "jobs"] },
  { title: "Field Trips", url: "/trips", group: "Work", keywords: ["trip", "route", "tractor"] },
  { title: "Pins / Repairs / Observations", url: "/pins", group: "Work", keywords: ["pin", "repair", "observation", "issue"] },
  { title: "Maintenance Logs", url: "/maintenance", group: "Work", keywords: ["maintenance", "service", "repair"] },
  { title: "Yields", url: "/yield", group: "Work", keywords: ["yield", "harvest", "tonnes"] },
  { title: "Damage Records", url: "/damage-records", group: "Work", keywords: ["damage", "loss", "frost", "hail"] },

  // Equipment
  { title: "Tractors", url: "/setup/tractors", group: "Equipment", keywords: ["tractor", "machine"] },
  { title: "Spray Equipment", url: "/setup/spray-equipment", group: "Equipment", keywords: ["sprayer", "nozzle", "boom"] },
  { title: "Vineyard Machines", url: "/setup/vineyard-machines", group: "Equipment", keywords: ["machine", "implement"] },
  { title: "Other Equipment & Assets", url: "/setup/equipment-other", group: "Equipment", keywords: ["assets", "tools"] },
  { title: "Fuel", url: "/fuel", group: "Equipment", keywords: ["fuel", "diesel", "petrol", "purchases"] },
  { title: "Fuel Purchases", url: "/fuel/purchases", group: "Equipment", keywords: ["fuel", "purchase", "receipt"] },
  { title: "Tractor Fuel Logs", url: "/fuel/tractor-logs", group: "Equipment", keywords: ["fuel", "tractor", "logs", "hours"] },

  // Tools
  { title: "Irrigation Advisor", url: "/tools/irrigation", group: "Tools", keywords: ["irrigation", "water", "calculator"] },

  // Reports
  { title: "Trip Reports", url: "/reports/trips", group: "Reports", keywords: ["trip", "reports"] },
  { title: "Work Task Reports", url: "/reports/work-tasks", group: "Reports", keywords: ["work", "reports"] },
  { title: "Spray Records", url: "/reports/spray", group: "Reports", keywords: ["spray", "records", "compliance"] },
  { title: "Rainfall Reports", url: "/reports/rainfall", group: "Reports", keywords: ["rain", "rainfall", "weather"] },
  { title: "Growth Stage Records", url: "/reports/growth-stage", group: "Reports", keywords: ["growth", "stage", "phenology"] },
  { title: "Documents & Exports", url: "/reports/documents", group: "Reports", keywords: ["documents", "exports", "files"] },
  { title: "Cost Reports", url: "/reports/costs", group: "Reports", keywords: ["cost", "money", "expenses"], adminOnly: true },
  { title: "Data Coverage", url: "/reports/data-coverage", group: "Reports", keywords: ["coverage", "data"], adminOnly: true },

  // Setup
  { title: "Team", url: "/team", group: "Setup", keywords: ["team", "users", "members", "invite"] },
  { title: "Billing", url: "/billing", group: "Setup", keywords: ["billing", "subscription", "payment", "stripe"] },
  { title: "Vineyard Settings", url: "/setup/vineyard", group: "Setup", keywords: ["vineyard", "settings", "logo", "name"] },
  { title: "Vineyard Location", url: "/setup/vineyard-location", group: "Setup", keywords: ["location", "map", "coordinates", "address"] },
  { title: "Region & Units", url: "/setup/region-units", group: "Setup", keywords: ["region", "units", "metric", "imperial", "timezone", "season"] },
  { title: "Blocks", url: "/setup/paddocks", group: "Setup", keywords: ["blocks", "paddocks", "rows"] },
  { title: "Grape Varieties", url: "/setup/grape-varieties", group: "Setup", keywords: ["grapes", "varieties", "clones"] },
  { title: "Chemicals", url: "/setup/chemicals", group: "Setup", keywords: ["chemicals", "saved", "products"] },
  { title: "Operator Categories", url: "/setup/operator-categories", group: "Setup", keywords: ["operators", "categories", "labels"] },
  { title: "Saved Inputs", url: "/setup/saved-inputs", group: "Setup", keywords: ["inputs", "presets", "saved"] },
  { title: "Weather Settings", url: "/setup/weather", group: "Setup", keywords: ["weather", "station", "davis", "willyweather", "wunderground"] },

  // System admin
  { title: "Admin Dashboard", url: "/admin/dashboard", group: "System Admin", systemAdminOnly: true },
  { title: "Admin — Users", url: "/admin/users", group: "System Admin", systemAdminOnly: true, keywords: ["users"] },
  { title: "Admin — Vineyards", url: "/admin/vineyards", group: "System Admin", systemAdminOnly: true, keywords: ["vineyards"] },
  { title: "Admin — Blocks", url: "/admin/blocks", group: "System Admin", systemAdminOnly: true, keywords: ["blocks", "paddocks"] },
  { title: "Admin — Pins", url: "/admin/pins", group: "System Admin", systemAdminOnly: true },
  { title: "Admin — Spray Records", url: "/admin/spray-records", group: "System Admin", systemAdminOnly: true },
  { title: "Admin — Work Tasks", url: "/admin/work-tasks", group: "System Admin", systemAdminOnly: true },
  { title: "Admin — Invitations", url: "/admin/invitations", group: "System Admin", systemAdminOnly: true },
  { title: "User Activity", url: "/admin/user-activity", group: "System Admin", systemAdminOnly: true },
  { title: "Block Troubleshooter", url: "/admin/block-troubleshooter", group: "System Admin", systemAdminOnly: true },
  { title: "Support Requests", url: "/admin/support-requests", group: "System Admin", systemAdminOnly: true, keywords: ["support", "tickets"] },
  { title: "System Admins", url: "/admin/system-admins", group: "System Admin", systemAdminOnly: true },
  { title: "Billing Grants", url: "/admin/billing-grants", group: "System Admin", systemAdminOnly: true },
  { title: "App Notices", url: "/admin/notices", group: "System Admin", systemAdminOnly: true, keywords: ["notice", "banner"] },
  { title: "Feature Flags", url: "/admin/feature-flags", group: "System Admin", systemAdminOnly: true, keywords: ["flags", "features"] },
];

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const navigate = useNavigate();
  const { currentRole } = useVineyard();
  const { isAdmin: isSystemAdmin } = useIsSystemAdmin();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isAdmin = currentRole === "owner" || currentRole === "manager";

  const visibleItems = useMemo(
    () =>
      ITEMS.filter((i) => {
        if (i.systemAdminOnly && !isSystemAdmin) return false;
        if (i.adminOnly && !isAdmin) return false;
        return canAccessRoute(i.url, currentRole);
      }),
    [currentRole, isAdmin, isSystemAdmin],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as SearchItem[];
    const scored = visibleItems
      .map((item) => {
        const hay = [item.title, item.group, ...(item.keywords ?? [])]
          .join(" ")
          .toLowerCase();
        const idx = hay.indexOf(q);
        if (idx === -1) return null;
        // Prefer title matches
        const titleIdx = item.title.toLowerCase().indexOf(q);
        const score = titleIdx === 0 ? 0 : titleIdx > -1 ? 1 : 2 + idx;
        return { item, score };
      })
      .filter((x): x is { item: SearchItem; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 12)
      .map((x) => x.item);
    return scored;
  }, [query, visibleItems]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

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
        go(results[activeIdx].url);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        placeholder="Search settings, pages, reports…  (⌘K)"
        className="pl-9 pr-14 h-9 rounded-full bg-muted/60 border-transparent focus-visible:bg-card focus-visible:border-input"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden md:inline-flex h-5 items-center rounded border border-border bg-background px-1.5 text-[10px] font-medium text-muted-foreground">
        ⌘K
      </kbd>
      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg overflow-hidden">
          {results.length === 0 ? (
            <div className="px-3 py-6 text-sm text-muted-foreground text-center">
              No matches for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {results.map((item, idx) => (
                <li key={item.url}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIdx(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      go(item.url);
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
