import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, CloudRain, FolderOpen, ArrowRight, Route } from "lucide-react";

const sections = [
  {
    to: "/reports/trips",
    title: "Trip Reports",
    description:
      "Per-trip PDF reports for every trip type — Maintenance, Spray, Seeding, Mowing, Harrowing, Canopy Work and Custom jobs.",
    icon: Route,
    status: "Available",
  },
  {
    to: "/reports/spray",
    title: "Spray Records & Compliance",
    description:
      "Spray-specific reports: chemicals, rates, WHP/REI, weather and tank mix, plus yearly spray program exports (PDF / Excel).",
    icon: FileText,
    status: "Available",
  },
  {
    to: "/reports/rainfall",
    title: "Rainfall Reports",
    description:
      "Daily rainfall, monthly calendar, summaries and PDF/CSV exports.",
    icon: CloudRain,
    status: "Available",
  },
  {
    to: "/reports/documents",
    title: "Documents & Exports",
    description:
      "Central launcher for Trip, Spray and Rainfall report PDFs/CSVs.",
    icon: FolderOpen,
    status: "Available",
  },
];

export default function ReportsIndexPage() {
  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold">Reports &amp; Exports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Vineyard-level reports for Owners and Managers. Generate compliance
          documents and exports from your VineTrack data.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.to} to={s.to}>
              <Card className="p-4 h-full hover:bg-accent/30 transition-colors space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    <h2 className="font-medium">{s.title}</h2>
                  </div>
                  <Badge variant={s.status === "Available" ? "default" : s.status === "Partial" ? "secondary" : "outline"}>
                    {s.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{s.description}</p>
                <div className="text-xs text-primary flex items-center gap-1 pt-1">
                  Open <ArrowRight className="h-3 w-3" />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
