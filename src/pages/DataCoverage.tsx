import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";

const coverage = [
  {
    table: "Paddocks",
    fields: ["name", "rows", "vine_spacing"],
  },
  {
    table: "Tractors",
    fields: ["name", "model"],
  },
  {
    table: "Spray equipment",
    fields: ["name", "tank_capacity_litres"],
  },
];

export default function DataCoverage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Data coverage</h1>
        <p className="text-sm text-muted-foreground">
          Schema notes for the read-only web portal.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Read-only MVP</AlertTitle>
        <AlertDescription>
          Some richer iOS app fields are not visible in the discovered web schema yet.
          Columns shown below are the ones currently surfaced in the portal.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {coverage.map((c) => (
          <Card key={c.table}>
            <CardHeader>
              <CardTitle className="text-base">{c.table}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-1">
                {c.fields.map((f) => (
                  <li key={f}>
                    <code className="text-foreground">{f}</code>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Missing records?</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          If expected records are missing, check that the selected vineyard is correct
          and that this user has owner/manager access.
        </CardContent>
      </Card>
    </div>
  );
}
