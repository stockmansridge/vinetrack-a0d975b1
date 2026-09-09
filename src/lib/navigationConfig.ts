// Shared navigation definitions for the Portal.
//
// One source of truth for the sidebar, the activity navigation row, the global
// search index and the report catalogue. It describes WHERE things live; it
// never grants access. Every destination keeps its existing route and its
// existing route guard — this file only decides what is *shown*.

import {
  Activity,
  AlertTriangle,
  Beaker,
  BookOpen,
  CloudRain,
  ClipboardList,
  CreditCard,
  Database,
  DollarSign,
  Droplet,
  FileBarChart,
  FolderOpen,
  Fuel,
  Globe2,
  Grape,
  LayoutDashboard,
  Layers,
  Map,
  MapPin,
  Plug,
  Route,
  Satellite,
  Scissors,
  Settings2,
  ShieldCheck,
  Sprout,
  Tractor,
  UserCog,
  Users,
  Wrench,
} from "lucide-react";
import { canAccessRoute } from "@/lib/rolePermissions";

export type NavGroup = "Overview" | "Vineyard" | "Work" | "Resources" | "Settings";

export interface NavViewer {
  role: string | null | undefined;
  isSystemAdmin: boolean;
  irrigation: {
    records: boolean;
    reports: boolean;
    setup: boolean;
  };
  /** True when the signed-in user has at least one account-billing vineyard. */
  hasAccountBilling: boolean;
  /** True while access information is still loading. */
  loading?: boolean;
}

export interface NavView {
  id: string;
  /** Short navigation label. */
  label: string;
  /** Existing route. Never renamed by this navigation layer. */
  path: string;
  /** Additional route families that belong to this view (prefix + boundary). */
  family?: string[];
  /** Old labels / search terms that must still resolve here. */
  keywords?: string[];
  /** Extra visibility rule on top of the route matrix. */
  visible?: (v: NavViewer) => boolean;
  /** Shown in the reports catalogue. */
  report?: boolean;
  /** Marked as an internal System Admin surface. */
  adminSurface?: boolean;
}

export interface NavCrossLink {
  label: string;
  path: string;
}

export interface NavActivity {
  id: string;
  label: string;
  group: NavGroup;
  icon: any;
  views: NavView[];
  /** Convenience links to other activities' homes. */
  crossLinks?: NavCrossLink[];
}

const irrigationRecords = (v: NavViewer) => v.irrigation.records;
const irrigationReports = (v: NavViewer) => v.irrigation.reports;
const irrigationSetup = (v: NavViewer) => v.irrigation.setup;
const systemAdminOnly = (v: NavViewer) => v.isSystemAdmin;

export const ACTIVITIES: NavActivity[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    group: "Overview",
    icon: LayoutDashboard,
    views: [
      { id: "dashboard.overview", label: "Overview", path: "/dashboard", keywords: ["home", "summary"] },
      { id: "dashboard.live", label: "Live Dashboard", path: "/dashboard/live", keywords: ["live", "realtime", "weather"] },
      {
        id: "dashboard.guide",
        label: "How VineTrack Works",
        path: "/dashboard/how-vinetrack-works",
        family: ["/dashboard/how-vinetrack-works"],
        visible: systemAdminOnly,
        adminSurface: true,
        keywords: ["guide", "help", "how it works"],
      },
    ],
  },
  {
    id: "blocks",
    label: "Blocks",
    group: "Vineyard",
    icon: Map,
    views: [
      {
        id: "blocks.overview",
        label: "Overview",
        path: "/paddocks",
        family: ["/blocks"],
        keywords: ["blocks", "paddocks", "rows", "block detail"],
      },
      {
        id: "blocks.setup",
        label: "Block Setup",
        path: "/setup/paddocks",
        family: ["/setup/paddocks"],
        keywords: ["block setup", "new block", "boundary", "paddocks"],
      },
      {
        id: "blocks.varieties",
        label: "Varieties",
        path: "/setup/grape-varieties",
        keywords: ["grapes", "varieties", "clones", "rootstock"],
      },
    ],
  },
  {
    id: "observations",
    label: "Pins & Observations",
    group: "Vineyard",
    icon: MapPin,
    views: [
      {
        id: "observations.pins",
        label: "Pins",
        path: "/pins",
        keywords: ["pin", "repair", "observation", "issue", "manual issues"],
      },
      {
        id: "observations.growth",
        label: "Growth Stages",
        path: "/reports/growth-stage",
        report: true,
        keywords: ["growth", "stage", "phenology", "e-l", "el", "heatmap", "ripeness"],
      },
      {
        id: "observations.damage",
        label: "Damage Records",
        path: "/damage-records",
        keywords: ["damage", "loss", "frost", "hail"],
      },
      {
        id: "observations.crophealth",
        label: "Crop Health Maps",
        path: "/tools/satellite-mapping",
        visible: systemAdminOnly,
        adminSurface: true,
        keywords: ["satellite", "ndvi", "crop health"],
      },
    ],
  },
  {
    id: "weather",
    label: "Weather",
    group: "Vineyard",
    icon: CloudRain,
    views: [
      {
        id: "weather.rainfall",
        label: "Rainfall",
        path: "/reports/rainfall",
        report: true,
        keywords: ["rain", "rainfall", "weather", "reports"],
      },
      {
        id: "weather.settings",
        label: "Weather Settings",
        path: "/setup/weather",
        keywords: ["weather", "station", "davis", "willyweather", "wunderground"],
      },
    ],
    crossLinks: [{ label: "Live Dashboard", path: "/dashboard/live" }],
  },
  {
    id: "trips",
    label: "Field Trips",
    group: "Work",
    icon: Sprout,
    views: [
      { id: "trips.list", label: "Trips", path: "/trips", keywords: ["trip", "route", "tractor", "gps"] },
      {
        id: "trips.reports",
        label: "Reports & Exports",
        path: "/reports/trips",
        report: true,
        keywords: ["trip reports", "trip pdf", "exports"],
      },
    ],
  },
  {
    id: "work-tasks",
    label: "Work Tasks",
    group: "Work",
    icon: ClipboardList,
    views: [
      { id: "work-tasks.list", label: "Tasks", path: "/work-tasks", keywords: ["tasks", "jobs", "labour"] },
      {
        id: "work-tasks.reports",
        label: "Reports",
        path: "/reports/work-tasks",
        report: true,
        keywords: ["task summary", "block allocation", "work task reports"],
      },
    ],
  },
  {
    id: "spraying",
    label: "Spraying",
    group: "Work",
    icon: Layers,
    views: [
      {
        id: "spraying.program",
        label: "Program & Jobs",
        path: "/spray-jobs",
        keywords: ["spray program", "planned sprays", "archived", "spray jobs", "templates"],
      },
      {
        id: "spraying.records",
        label: "Records",
        path: "/spray-records",
        keywords: ["spray records", "spray diary", "register"],
      },
      {
        id: "spraying.compliance",
        label: "Compliance Exports",
        path: "/reports/spray",
        report: true,
        keywords: ["spray compliance", "spray report", "whp", "rei", "spray diary export"],
      },
      {
        id: "spraying.resistance",
        label: "Resistance Planner",
        path: "/tools/resistance-planner",
        keywords: ["resistance", "frac", "powdery", "downy", "strategy"],
      },
      {
        id: "spraying.chemicals",
        label: "Chemicals",
        path: "/setup/chemicals",
        keywords: ["chemicals", "saved chemicals", "products", "label"],
      },
    ],
    crossLinks: [{ label: "Spray Equipment", path: "/setup/spray-equipment" }],
  },
  {
    id: "pruning",
    label: "Pruning",
    group: "Work",
    icon: Scissors,
    views: [
      {
        id: "pruning.tracker",
        label: "Tracker",
        path: "/tools/pruning-tracker",
        keywords: ["pruning tracker", "pruning"],
      },
      {
        id: "pruning.activity",
        label: "Activity Report",
        path: "/reports/pruning-activity",
        report: true,
        keywords: ["pruning report", "pruning activity", "productivity"],
      },
      {
        id: "pruning.calculator",
        label: "Pruning Yield Calculator",
        path: "/tools/yield-estimation",
        keywords: ["yield estimation", "buds", "bunch", "calculator"],
      },
    ],
  },
  {
    id: "yield",
    label: "Yield & Harvest",
    group: "Work",
    icon: Grape,
    views: [
      {
        id: "yield.records",
        label: "Records",
        path: "/yield",
        keywords: ["yields", "harvest", "bunch count", "picking log", "grape allocation", "actual yields"],
      },
      {
        id: "yield.analytics",
        label: "Analytics",
        path: "/reports/yield",
        report: true,
        keywords: ["yield analytics", "charts", "revenue", "price"],
      },
      {
        id: "yield.comparison",
        label: "Comparison",
        path: "/reports/yield-comparison",
        report: true,
        keywords: ["yield comparison", "vintage comparison"],
      },
    ],
    crossLinks: [
      { label: "Pruning Yield Calculator", path: "/tools/yield-estimation" },
      { label: "Damage Records", path: "/damage-records" },
    ],
  },
  {
    id: "irrigation",
    label: "Irrigation",
    group: "Work",
    icon: Droplet,
    views: [
      {
        id: "irrigation.advisor",
        label: "Advisor",
        path: "/tools/irrigation",
        keywords: ["irrigation advisor", "water", "soil", "calculator"],
      },
      {
        id: "irrigation.records",
        label: "Records & History",
        path: "/irrigation",
        family: ["/irrigation/history", "/irrigation/record", "/irrigation/import"],
        visible: irrigationRecords,
        keywords: ["irrigation records", "irrigation history", "watering"],
      },
      {
        id: "irrigation.reports",
        label: "Reports",
        path: "/reports/irrigation",
        report: true,
        visible: irrigationReports,
        keywords: ["irrigation reports"],
      },
      {
        id: "irrigation.setup",
        label: "Setup",
        path: "/irrigation/setup",
        visible: irrigationSetup,
        keywords: ["irrigation setup", "emitters", "zones"],
      },
    ],
  },
  {
    id: "equipment",
    label: "Equipment & Fuel",
    group: "Resources",
    icon: Tractor,
    views: [
      {
        id: "equipment.tractors",
        label: "Tractors",
        path: "/setup/tractors",
        family: ["/setup/tractors"],
        keywords: ["tractor", "machine"],
      },
      {
        id: "equipment.sprayers",
        label: "Spray Equipment",
        path: "/setup/spray-equipment",
        family: ["/setup/spray-equipment"],
        keywords: ["sprayer", "nozzle", "boom"],
      },
      {
        id: "equipment.machines",
        label: "Vineyard Machines",
        path: "/setup/vineyard-machines",
        keywords: ["machine", "implement"],
      },
      {
        id: "equipment.other",
        label: "Other Assets",
        path: "/setup/equipment-other",
        keywords: ["assets", "tools", "other equipment"],
      },
      {
        id: "equipment.maintenance",
        label: "Maintenance",
        path: "/maintenance",
        keywords: ["maintenance", "service", "repair", "logs"],
      },
      {
        id: "equipment.fuel",
        label: "Fuel",
        path: "/fuel",
        keywords: ["fuel", "diesel", "petrol"],
      },
      {
        id: "equipment.fuelPurchases",
        label: "Fuel Purchases",
        path: "/fuel-purchases",
        keywords: ["fuel purchases", "receipt", "invoice"],
      },
      {
        id: "equipment.tractorFuelLogs",
        label: "Machine Fuel Logs",
        path: "/tractor-fuel-logs",
        keywords: ["tractor fuel logs", "machine logs", "hours"],
      },
    ],
  },
  {
    id: "reports",
    label: "Reports & Exports",
    group: "Resources",
    icon: FileBarChart,
    views: [
      { id: "reports.catalogue", label: "Report Catalogue", path: "/reports", keywords: ["reports", "catalogue"] },
      {
        id: "reports.costs",
        label: "Cost Reports",
        path: "/reports/costs",
        report: true,
        keywords: ["cost", "money", "expenses"],
      },
      {
        id: "reports.documents",
        label: "Export Launcher",
        path: "/reports/documents",
        report: true,
        keywords: ["documents", "exports", "files", "launcher"],
      },
    ],
  },
  {
    id: "settings",
    label: "Vineyard Settings",
    group: "Settings",
    icon: Settings2,
    views: [
      {
        id: "settings.vineyard",
        label: "Vineyard",
        path: "/setup/vineyard",
        keywords: ["vineyard settings", "logo", "name", "country"],
      },
      {
        id: "settings.location",
        label: "Location",
        path: "/setup/vineyard-location",
        keywords: ["location", "map", "coordinates", "address"],
      },
      {
        id: "settings.region",
        label: "Region & Units",
        path: "/setup/region-units",
        keywords: ["region", "units", "metric", "timezone"],
      },
      {
        id: "settings.season",
        label: "Growing Season",
        path: "/setup/operational-preferences",
        keywords: ["growing season", "operational preferences", "season"],
      },
      { id: "settings.team", label: "Team", path: "/team", keywords: ["team", "users", "members", "invite", "people"] },
      {
        id: "settings.workerTypes",
        label: "Worker Types",
        path: "/setup/operator-categories",
        keywords: ["operators", "worker types", "categories"],
      },
      {
        id: "settings.savedInputs",
        label: "Saved Inputs",
        path: "/setup/saved-inputs",
        keywords: ["inputs", "presets", "saved inputs"],
      },
      {
        id: "settings.dataHealth",
        label: "Data Health",
        path: "/reports/data-coverage",
        keywords: ["data coverage", "data health", "diagnostics"],
      },
      {
        id: "settings.integrations",
        label: "Integrations & API",
        path: "/settings/integrations",
        family: ["/settings/integrations"],
        keywords: ["api", "integrations", "developer", "keys", "docs"],
      },
    ],
    crossLinks: [
      { label: "Blocks", path: "/setup/paddocks" },
      { label: "Varieties", path: "/setup/grape-varieties" },
      { label: "Weather Settings", path: "/setup/weather" },
      { label: "Irrigation Setup", path: "/irrigation/setup" },
      { label: "Chemicals", path: "/setup/chemicals" },
    ],
  },
];

/** Billing lives in the top-right account menu, not the sidebar. */
export const ACCOUNT_ACTIVITY: NavActivity = {
  id: "account-billing",
  label: "Billing",
  group: "Settings",
  icon: CreditCard,
  views: [
    {
      id: "account.billingInvoices",
      label: "Billing & Invoices",
      path: "/account/billing",
      keywords: ["billing", "invoices", "renewal", "account billing"],
      visible: (v) => v.hasAccountBilling,
    },
    {
      id: "account.plans",
      label: "Plans & Licences",
      path: "/billing",
      keywords: ["plans", "licences", "subscription", "checkout", "payment"],
    },
  ],
};

export const SYSTEM_ADMIN_ITEMS: { label: string; path: string; icon: any }[] = [
  { label: "Admin Dashboard", path: "/admin/dashboard", icon: LayoutDashboard },
  { label: "User Activity", path: "/admin/user-activity", icon: Activity },
  { label: "Users", path: "/admin/users", icon: Users },
  { label: "Vineyards", path: "/admin/vineyards", icon: Grape },
  { label: "Blocks", path: "/admin/blocks", icon: Map },
  { label: "Pins", path: "/admin/pins", icon: MapPin },
  { label: "Spray Records", path: "/admin/spray-records", icon: Beaker },
  { label: "Work Tasks", path: "/admin/work-tasks", icon: ClipboardList },
  { label: "Invitations", path: "/admin/invitations", icon: UserCog },
  { label: "Integrations", path: "/admin/integrations", icon: Plug },
  { label: "Master Catalogue", path: "/admin/master-catalogue", icon: Beaker },
  { label: "Block Troubleshooter", path: "/admin/block-troubleshooter", icon: ShieldCheck },
  { label: "Support Requests", path: "/admin/support-requests", icon: AlertTriangle },
  { label: "System Admins", path: "/admin/system-admins", icon: ShieldCheck },
  { label: "Access & Entitlements", path: "/admin/access-entitlements", icon: ShieldCheck },
  { label: "Billing Grants", path: "/admin/billing-grants", icon: DollarSign },
  { label: "App Notices", path: "/admin/notices", icon: Globe2 },
  { label: "Maintenance Mode", path: "/admin/maintenance", icon: Settings2 },
  { label: "Feature Flags", path: "/admin/feature-flags", icon: ShieldCheck },
  { label: "Canopy Reference Images", path: "/admin/canopy-images", icon: Satellite },
  { label: "Guide Content", path: "/admin/guide-content", icon: BookOpen },
  { label: "Email Test", path: "/admin/email-diagnostics", icon: FolderOpen },
  { label: "Fertiliser Calculator", path: "/tools/fertiliser-calculator", icon: Beaker },
  { label: "How VineTrack Works", path: "/dashboard/how-vinetrack-works", icon: BookOpen },
  { label: "Portal Field Reference", path: "/settings/data-coverage", icon: Database },
];

/** Unused icon references kept for tree-shaking clarity. */
void [Route, Fuel, Wrench, Sprout];

export function isViewAccessible(view: NavView, viewer: NavViewer): boolean {
  if (!canAccessRoute(view.path, viewer.role)) return false;
  if (view.visible && !view.visible(viewer)) return false;
  return true;
}

export function accessibleViews(activity: NavActivity, viewer: NavViewer): NavView[] {
  return activity.views.filter((v) => isViewAccessible(v, viewer));
}

/** The activity's default destination: the first child the viewer may open. */
export function defaultPathFor(activity: NavActivity, viewer: NavViewer): string | null {
  return accessibleViews(activity, viewer)[0]?.path ?? null;
}

export function accessibleActivities(viewer: NavViewer): NavActivity[] {
  return ACTIVITIES.filter((a) => accessibleViews(a, viewer).length > 0);
}

function matchesPath(pathname: string, candidate: string): boolean {
  if (pathname === candidate) return true;
  return pathname.startsWith(candidate + "/");
}

export interface ResolvedLocation {
  activity: NavActivity | null;
  view: NavView | null;
}

/**
 * Resolve the current URL to an activity/view.
 *
 * Exact destination paths win over dynamic route families, so
 * `/settings/integrations/docs` is never mistaken for a client ID and
 * `/reports/yield-comparison` is never swallowed by `/reports/yield`.
 */
export function resolveLocation(pathname: string): ResolvedLocation {
  const all = [...ACTIVITIES, ACCOUNT_ACTIVITY];
  for (const activity of all) {
    for (const view of activity.views) {
      if (view.path === pathname) return { activity, view };
    }
  }
  let best: { activity: NavActivity; view: NavView; length: number } | null = null;
  for (const activity of all) {
    for (const view of activity.views) {
      for (const candidate of [view.path, ...(view.family ?? [])]) {
        if (matchesPath(pathname, candidate) && (!best || candidate.length > best.length)) {
          best = { activity, view, length: candidate.length };
        }
      }
    }
  }
  return best ? { activity: best.activity, view: best.view } : { activity: null, view: null };
}

export interface SearchDestination {
  title: string;
  path: string;
  group: string;
  keywords: string[];
  view: NavView;
  activity: NavActivity;
}

/** Every destination the viewer may open, for the global search index. */
export function searchDestinations(viewer: NavViewer): SearchDestination[] {
  const out: SearchDestination[] = [];
  for (const activity of [...ACTIVITIES, ACCOUNT_ACTIVITY]) {
    for (const view of activity.views) {
      if (!isViewAccessible(view, viewer)) continue;
      out.push({
        title: view.label,
        path: view.path,
        group: activity.label,
        keywords: [activity.label, ...(view.keywords ?? [])],
        view,
        activity,
      });
    }
  }
  if (viewer.isSystemAdmin) {
    for (const item of SYSTEM_ADMIN_ITEMS) {
      out.push({
        title: item.label,
        path: item.path,
        group: "System Admin",
        keywords: ["admin", item.label.toLowerCase()],
        view: { id: `admin:${item.path}`, label: item.label, path: item.path },
        activity: { id: "system-admin", label: "System Admin", group: "Settings", icon: ShieldCheck, views: [] },
      });
    }
  }
  return out;
}

/** Report destinations for the `/reports` catalogue, in activity order. */
export function reportDestinations(viewer: NavViewer): SearchDestination[] {
  return searchDestinations(viewer).filter((d) => d.view.report);
}
