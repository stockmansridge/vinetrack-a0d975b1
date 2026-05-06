import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CloudRain, Info } from "lucide-react";

export default function RainfallReportsPage() {
  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Rainfall Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Daily, monthly and yearly rainfall summaries for the vineyard.
        </p>
      </div>

      <Card className="p-6 space-y-3 text-center">
        <CloudRain className="h-8 w-8 mx-auto text-muted-foreground" />
        <div className="font-medium">Rainfall history not available yet</div>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto">
          Rainfall history requires persisted rainfall data or a safe server-side
          rainfall RPC. The portal will not fetch Davis WeatherLink directly from
          the browser.
        </p>
        <div className="flex justify-center gap-2 pt-2">
          <Button size="sm" variant="outline" disabled>
            Export rain table (CSV)
          </Button>
          <Button size="sm" variant="outline" disabled>
            Export season summary (PDF)
          </Button>
        </div>
      </Card>

      <Card className="p-4 space-y-2 bg-muted/30">
        <div className="flex items-center gap-2 font-medium text-sm">
          <Info className="h-4 w-4" /> What is needed
        </div>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-5">
          <li>
            A persisted <code className="font-mono">rainfall_daily</code> table,
            populated by Rork from Davis / Open-Meteo, or
          </li>
          <li>
            A safe RPC such as{" "}
            <code className="font-mono">get_vineyard_rainfall_history</code> that
            returns daily totals without exposing station credentials.
          </li>
        </ul>
      </Card>
    </div>
  );
}
