import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { ArrowRight, Route, ClipboardList, Scissors, SprayCan, CloudRain, Sprout, Grape, ChartNoAxesCombined, Droplets, Receipt, CircleDollarSign, Files, type LucideIcon } from "lucide-react";
import { useNavViewer } from "@/hooks/useNavViewer";
import { reportDestinations } from "@/lib/navigationConfig";

const DESCRIPTIONS: Record<string, string> = {
  "/reports/trips":
    "Per-trip PDF reports for every trip type — Maintenance, Spray, Seeding, Mowing, Harrowing, Canopy Work and Custom jobs.",
  "/reports/work-tasks":
    "Task-level roll-up of manual labour, manual machine work and linked GPS trips. Read-only — does not affect Cost Reports.",
  "/reports/pruning-activity":
    "Every recorded pruning entry — rows worked, quarters, vines, labour hours, productivity and linked work tasks, with CSV/PDF export.",
  "/reports/spray":
    "Spray-specific reports: chemicals, rates, WHP/REI, weather and tank mix, plus yearly spray program exports (PDF / Excel).",
  "/reports/rainfall": "Daily rainfall, monthly calendar, summaries and PDF/CSV exports.",
  "/reports/growth-stage": "Recorded E-L growth stages by block, with heat map and export.",
  "/reports/yield": "Yield analytics by block, variety and vintage, including price and revenue where permitted.",
  "/reports/yield-comparison": "Compare yields across vintages and blocks.",
  "/reports/irrigation": "Irrigation volumes and history reporting.",
  "/reports/wine-grape-levy":
    "Preparation worksheet for your annual Wine Grapes Levy return in Levies Online (Owners and Managers). VineTrack does not lodge or pay the levy.",
  "/reports/costs": "Vineyard cost reporting for Owners and Managers.",
  "/reports/documents": "Central launcher for Trip, Spray and Rainfall report PDFs/CSVs.",
};

const REPORT_ICONS: Record<string, LucideIcon> = {
  "/reports/trips": Route,
  "/reports/work-tasks": ClipboardList,
  "/reports/pruning-activity": Scissors,
  "/reports/spray": SprayCan,
  "/reports/rainfall": CloudRain,
  "/reports/growth-stage": Sprout,
  "/reports/yield": Grape,
  "/reports/yield-comparison": ChartNoAxesCombined,
  "/reports/irrigation": Droplets,
  "/reports/wine-grape-levy": Receipt,
  "/reports/costs": CircleDollarSign,
  "/reports/documents": Files,
};

export default function ReportsIndexPage() {
  const viewer = useNavViewer();
  const reports = reportDestinations(viewer);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold">Reports &amp; Exports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Vineyard-level reports and exports generated from your VineTrack data.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {reports.map((r) => {
          const Icon = REPORT_ICONS[r.path] ?? r.activity.icon;
          return (
            <Link key={r.path} to={r.path} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              <Card data-report={r.path.split("/").pop()} className="report-tile p-4 h-full transition-colors space-y-3 rounded-lg">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-report/15 text-report" aria-hidden="true">
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-semibold leading-snug">
                      {r.activity.label} — {r.title}
                    </h2>
                    <span className="text-xs font-medium text-report">Available</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {DESCRIPTIONS[r.path] ?? `Open the ${r.title.toLowerCase()} report.`}
                </p>
                <div className="text-xs font-semibold text-report flex items-center gap-1 pt-1">
                  Open <ArrowRight className="h-3 w-3" />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Vineyard Data Health is available under Vineyard Settings.
      </p>
    </div>
  );
}
