import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
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
  "/reports/costs": "Vineyard cost reporting for Owners and Managers.",
  "/reports/documents": "Central launcher for Trip, Spray and Rainfall report PDFs/CSVs.",
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
          const Icon = r.activity.icon;
          return (
            <Link key={r.path} to={r.path}>
              <Card className="p-4 h-full hover:bg-accent/30 transition-colors space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    <h2 className="font-medium">
                      {r.activity.label} — {r.title}
                    </h2>
                  </div>
                  <Badge variant="default">Available</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {DESCRIPTIONS[r.path] ?? `Open the ${r.title.toLowerCase()} report.`}
                </p>
                <div className="text-xs text-primary flex items-center gap-1 pt-1">
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
