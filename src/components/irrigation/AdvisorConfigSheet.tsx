import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Settings2 } from "lucide-react";
import { useDiagnosticPanel } from "@/lib/systemAdmin";

interface Section {
  title: string;
  content: React.ReactNode;
}

interface Props {
  weatherSources?: React.ReactNode;
  recentRain?: React.ReactNode;
  forecast?: React.ReactNode;
  forecastDetails?: React.ReactNode;
  dailyBreakdown?: React.ReactNode;
  calculationAssumptions?: React.ReactNode;
  blockSettings?: React.ReactNode;
  soilProfile?: React.ReactNode;
  diagnostics?: React.ReactNode;
  triggerLabel?: string;
}

export default function AdvisorConfigSheet(props: Props) {
  const showDiagnostics = useDiagnosticPanel("show_raw_json_panels");

  const sections: Section[] = [
    { title: "Weather Sources", content: props.weatherSources },
    { title: "Recent Rain", content: props.recentRain },
    { title: "Forecast", content: props.forecast },
    { title: "Forecast Details", content: props.forecastDetails },
    { title: "Daily Breakdown", content: props.dailyBreakdown },
    { title: "Calculation Assumptions", content: props.calculationAssumptions },
    { title: "Block Settings", content: props.blockSettings },
    { title: "Soil Profile", content: props.soilProfile },
  ].filter((s) => !!s.content) as Section[];

  if (showDiagnostics && props.diagnostics) {
    sections.push({ title: "Diagnostics", content: props.diagnostics });
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="h-4 w-4 mr-1" />
          {props.triggerLabel ?? "Irrigation Advisor Config"}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>Irrigation Advisor Config</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-6">
          {sections.map((s) => (
            <section key={s.title} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">
                {s.title}
              </h3>
              <div>{s.content}</div>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
