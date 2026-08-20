// Visual hooks for the How VineTrack Works guide.
//
// Stage 2 provides icon-based placeholders only. Later stages can attach real
// assets (portal screenshots, iPhone/Android screenshots, vineyard photography,
// workflow illustrations) by extending GUIDE_VISUALS — components must keep
// resolving through `guideVisual(visualKey)` rather than hard-coding paths.

import {
  Grape,
  Map as MapIcon,
  Sprout,
  Cloud,
  Tractor,
  Users,
  Beaker,
  Droplet,
  Settings2,
  MapPin,
  Route,
  Layers,
  ShieldCheck,
  ClipboardList,
  Scissors,
  Wrench,
  Fuel,
  FlaskConical,
  Thermometer,
  Bug,
  DollarSign,
  FileBarChart,
  FolderOpen,
  Database,
  Satellite,
  Leaf,
  Compass,
  Apple,
  Smartphone,
  Monitor,
  Plug,
  LifeBuoy,
  CloudRain,
  BookOpen,
} from "lucide-react";

type LucideIcon = typeof BookOpen;

export interface GuideVisual {
  Icon: LucideIcon;
  /** Tailwind classes for the placeholder media area. Tokens only. */
  tone: string;
  /** Reserved for Stage 4+ imagery. */
  imageSrc?: string;
}

const DEFAULT_VISUAL: GuideVisual = {
  Icon: BookOpen,
  tone: "from-muted to-muted/40 text-muted-foreground",
};

const GUIDE_VISUALS: Record<string, GuideVisual> = {
  // Landing-page areas (Stage 2.6). Real imagery attaches here via `imageSrc`.
  "area.setup": { Icon: Grape, tone: "from-primary/20 via-primary/10 to-transparent text-primary" },
  "area.pins": { Icon: MapPin, tone: "from-orange-500/20 via-orange-500/10 to-transparent text-orange-600 dark:text-orange-400" },
  "area.trips": { Icon: Route, tone: "from-sky-500/20 via-sky-500/10 to-transparent text-sky-600 dark:text-sky-400" },
  "area.sprays": { Icon: Droplet, tone: "from-cyan-500/20 via-cyan-500/10 to-transparent text-cyan-600 dark:text-cyan-400" },
  "area.work_tasks": { Icon: ClipboardList, tone: "from-indigo-500/20 via-indigo-500/10 to-transparent text-indigo-600 dark:text-indigo-400" },
  "area.tools": { Icon: Wrench, tone: "from-amber-500/20 via-amber-500/10 to-transparent text-amber-600 dark:text-amber-400" },
  "area.reports": { Icon: FileBarChart, tone: "from-teal-500/20 via-teal-500/10 to-transparent text-teal-600 dark:text-teal-400" },
  "area.platforms": { Icon: Smartphone, tone: "from-foreground/10 via-foreground/5 to-transparent text-foreground" },

  "hero.platforms": { Icon: Grape, tone: "from-primary/20 via-primary/10 to-transparent text-primary" },

  "core.vineyard": { Icon: Grape, tone: "from-primary/15 to-primary/5 text-primary" },
  "core.blocks": { Icon: MapIcon, tone: "from-primary/15 to-primary/5 text-primary" },
  "core.planting": { Icon: Sprout, tone: "from-primary/15 to-primary/5 text-primary" },
  "core.weather": { Icon: Cloud, tone: "from-sky-500/15 to-sky-500/5 text-sky-600 dark:text-sky-400" },
  "core.equipment": { Icon: Tractor, tone: "from-amber-500/15 to-amber-500/5 text-amber-600 dark:text-amber-400" },
  "core.team": { Icon: Users, tone: "from-indigo-500/15 to-indigo-500/5 text-indigo-600 dark:text-indigo-400" },
  "core.spray": { Icon: Beaker, tone: "from-sky-500/15 to-sky-500/5 text-sky-600 dark:text-sky-400" },
  "core.irrigation": { Icon: Droplet, tone: "from-cyan-500/15 to-cyan-500/5 text-cyan-600 dark:text-cyan-400" },
  "core.preferences": { Icon: Settings2, tone: "from-muted to-muted/40 text-muted-foreground" },

  "field.pins": { Icon: MapPin, tone: "from-orange-500/15 to-orange-500/5 text-orange-600 dark:text-orange-400" },
  "field.trips": { Icon: Route, tone: "from-primary/15 to-primary/5 text-primary" },
  "field.spray_trips": { Icon: Droplet, tone: "from-sky-500/15 to-sky-500/5 text-sky-600 dark:text-sky-400" },
  "field.spray_jobs": { Icon: Layers, tone: "from-sky-500/15 to-sky-500/5 text-sky-600 dark:text-sky-400" },
  "field.spray_planner": { Icon: ShieldCheck, tone: "from-purple-500/15 to-purple-500/5 text-purple-600 dark:text-purple-400" },
  "field.work_tasks": { Icon: ClipboardList, tone: "from-indigo-500/15 to-indigo-500/5 text-indigo-600 dark:text-indigo-400" },
  "field.pruning": { Icon: Scissors, tone: "from-teal-500/15 to-teal-500/5 text-teal-600 dark:text-teal-400" },
  "field.maintenance": { Icon: Wrench, tone: "from-amber-500/15 to-amber-500/5 text-amber-600 dark:text-amber-400" },
  "field.yield": { Icon: Grape, tone: "from-primary/15 to-primary/5 text-primary" },

  "tool.work_tasks": { Icon: ClipboardList, tone: "from-indigo-500/15 to-indigo-500/5 text-indigo-600 dark:text-indigo-400" },
  "tool.maintenance": { Icon: Wrench, tone: "from-amber-500/15 to-amber-500/5 text-amber-600 dark:text-amber-400" },
  "tool.fuel": { Icon: Fuel, tone: "from-rose-500/15 to-rose-500/5 text-rose-600 dark:text-rose-400" },
  "tool.irrigation_advisor": { Icon: Droplet, tone: "from-cyan-500/15 to-cyan-500/5 text-cyan-600 dark:text-cyan-400" },
  "tool.disease_risk": { Icon: Bug, tone: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-400" },
  "tool.yields": { Icon: Grape, tone: "from-orange-500/15 to-orange-500/5 text-orange-600 dark:text-orange-400" },
  "tool.growth_stages": { Icon: Leaf, tone: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-400" },
  "tool.optimal_ripeness": { Icon: Thermometer, tone: "from-pink-500/15 to-pink-500/5 text-pink-600 dark:text-pink-400" },
  "tool.cost_reports": { Icon: DollarSign, tone: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-400" },
  "tool.fertiliser": { Icon: FlaskConical, tone: "from-lime-500/15 to-lime-500/5 text-lime-600 dark:text-lime-400" },
  "tool.pruning_tracker": { Icon: Scissors, tone: "from-teal-500/15 to-teal-500/5 text-teal-600 dark:text-teal-400" },
  "tool.irrigation_records": { Icon: Droplet, tone: "from-cyan-500/15 to-cyan-500/5 text-cyan-600 dark:text-cyan-400" },
  "tool.resistance_planner": { Icon: ShieldCheck, tone: "from-purple-500/15 to-purple-500/5 text-purple-600 dark:text-purple-400" },

  "maps.vineyard_map": { Icon: MapIcon, tone: "from-primary/15 to-primary/5 text-primary" },
  "maps.boundary_editor": { Icon: MapIcon, tone: "from-primary/15 to-primary/5 text-primary" },
  "maps.row_guidance": { Icon: Compass, tone: "from-sky-500/15 to-sky-500/5 text-sky-600 dark:text-sky-400" },
  "maps.satellite_mapping": { Icon: Satellite, tone: "from-amber-500/15 to-amber-500/5 text-amber-600 dark:text-amber-400" },
  "maps.crop_health": { Icon: Leaf, tone: "from-muted to-muted/40 text-muted-foreground" },

  "reports.activity": { Icon: Route, tone: "from-primary/15 to-primary/5 text-primary" },
  "reports.costs": { Icon: DollarSign, tone: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-400" },
  "reports.spray": { Icon: FileBarChart, tone: "from-sky-500/15 to-sky-500/5 text-sky-600 dark:text-sky-400" },
  "reports.yield": { Icon: Grape, tone: "from-orange-500/15 to-orange-500/5 text-orange-600 dark:text-orange-400" },
  "reports.environment": { Icon: CloudRain, tone: "from-sky-500/15 to-sky-500/5 text-sky-600 dark:text-sky-400" },
  "reports.exports": { Icon: FolderOpen, tone: "from-muted to-muted/40 text-muted-foreground" },
  "reports.data_coverage": { Icon: Database, tone: "from-indigo-500/15 to-indigo-500/5 text-indigo-600 dark:text-indigo-400" },
  "reports.team": { Icon: Users, tone: "from-indigo-500/15 to-indigo-500/5 text-indigo-600 dark:text-indigo-400" },

  "platform.ios": { Icon: Apple, tone: "from-foreground/10 to-foreground/5 text-foreground" },
  "platform.android": { Icon: Smartphone, tone: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-400" },
  "platform.web": { Icon: Monitor, tone: "from-primary/15 to-primary/5 text-primary" },
  "platform.api": { Icon: Plug, tone: "from-indigo-500/15 to-indigo-500/5 text-indigo-600 dark:text-indigo-400" },
  "platform.support": { Icon: LifeBuoy, tone: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-400" },
};

export function guideVisual(visualKey?: string): GuideVisual {
  if (!visualKey) return DEFAULT_VISUAL;
  return GUIDE_VISUALS[visualKey] ?? DEFAULT_VISUAL;
}
