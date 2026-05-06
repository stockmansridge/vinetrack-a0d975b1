import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, FileSpreadsheet, Info } from "lucide-react";

function PlaceholderRow({
  title,
  description,
  status,
  icon: Icon,
}: {
  title: string;
  description: string;
  status: "available" | "blocked";
  icon: typeof FileText;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border rounded-md p-3">
      <div className="flex items-start gap-3">
        <Icon className="h-4 w-4 mt-0.5 text-muted-foreground" />
        <div>
          <div className="font-medium text-sm">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant={status === "available" ? "secondary" : "outline"}>
          {status === "available" ? "Coming soon" : "Blocked"}
        </Badge>
        <Button size="sm" variant="outline" disabled>
          Export
        </Button>
      </div>
    </div>
  );
}

export default function SprayReportsPage() {
  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Spray Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Export individual spray records and the yearly spray program. These
          reports are built from spray data captured by the iOS app.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <PlaceholderRow
          icon={FileText}
          title="Individual spray record (PDF)"
          description="Single completed spray record exported as a job sheet. Sourced from spray_records."
          status="available"
        />
        <PlaceholderRow
          icon={FileText}
          title="Yearly spray program (PDF)"
          description="Full season spray program. Requires planned spray_jobs table to separate planned vs actual."
          status="blocked"
        />
        <PlaceholderRow
          icon={FileSpreadsheet}
          title="Yearly spray program (Excel)"
          description="Spreadsheet of the season's spray program with totals and chemical usage. Same blocker as PDF."
          status="blocked"
        />
      </Card>

      <Card className="p-4 space-y-2 bg-muted/30">
        <div className="flex items-center gap-2 font-medium text-sm">
          <Info className="h-4 w-4" /> Data readiness
        </div>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-5">
          <li>
            <span className="font-medium text-foreground">Available now:</span>{" "}
            Completed spray activity captured from the iOS app via{" "}
            <code className="font-mono">spray_records</code> — chemical, rate,
            block, operator, equipment, weather snapshot.
          </li>
          <li>
            <span className="font-medium text-foreground">Blocked:</span> Yearly
            spray <em>program</em> exports require a separate{" "}
            <code className="font-mono">spray_jobs</code> table to model planned
            jobs and reusable templates. This needs a Rork/Supabase migration
            before portal exports can be produced.
          </li>
          <li>
            No write paths are added in the portal. Exports will be read-only
            generated documents.
          </li>
        </ul>
      </Card>
    </div>
  );
}
