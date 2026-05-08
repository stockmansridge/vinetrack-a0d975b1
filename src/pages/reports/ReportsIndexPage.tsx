import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, CloudRain, FolderOpen, ArrowRight } from "lucide-react";

const sections = [
  {
    to: "/reports/spray",
    title: "Spray Reports",
    description:
      "Individual spray jobs, yearly spray program (PDF / Excel). Built from spray_records.",
    icon: FileText,
    status: "Partial",
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
          Vineyard-level reports for Owners and Managers. This section is being
          built out — placeholder pages indicate what is coming and what is
          currently blocked by missing backend data.
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
