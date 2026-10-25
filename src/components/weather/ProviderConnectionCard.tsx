import { useState, type ReactNode } from "react";
import { Check, Settings2, ArrowRight, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Comparison labels map to existing provider capabilities, not new behaviour. */
export function providerCapabilityRows(provides: string[]) {
  return [
    { label: "Forecasts", supported: provides.includes("Forecasts") },
    { label: "Live observations", supported: provides.includes("Live observations") },
    { label: "Rainfall actuals", supported: provides.includes("Rainfall actuals") },
    { label: "Historical archive", supported: provides.includes("Historical rainfall archive") },
  ];
}

/** Local typographic brand treatments; these do not claim to be official logos. */
function ProviderWordmark({ name, mark, tone }: { name: string; mark: string; tone: string }) {
  const words = name === "Davis WeatherLink" ? <><span className="text-[10px] font-bold uppercase">DAVIS</span><span className="text-sm font-semibold">WeatherLink</span></>
    : name === "Weather Underground" ? <><span className="text-lg font-black leading-5">wunderground</span><span className="text-[9px] uppercase">Weather Underground</span></>
    : name === "MAIT iNTELLiWeb" ? <><span className="text-2xl font-black italic leading-6">MAIT</span><span className="text-[10px] font-semibold">iNTELLiWeb</span></>
    : name === "WillyWeather" ? <span className="text-base font-bold italic">WillyWeather</span>
    : <span className="text-base font-semibold">{mark}</span>;
  return <div className={`flex min-w-0 flex-col leading-tight ${tone}`}>{words}</div>;
}

/** Summary presentation only; provider-owned hooks and actions stay in the caller. */
export function ProviderConnectionCard({ name, mark, icon, tone, description, configured, builtIn, provides, usedFor, children, id }: {
  name: string; mark: string; icon: ReactNode; tone: string; description: string;
  configured?: boolean; builtIn?: boolean; provides: string[]; usedFor: string[];
  children?: ReactNode; id?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card id={id} className="flex h-full min-w-0 scroll-mt-6 flex-col rounded-lg bg-card p-3 shadow-sm">
        <div className="flex min-h-12 items-center gap-2">
          {name === "Open-Meteo" && <span className="shrink-0 text-map-accent">{icon}</span>}
          <ProviderWordmark name={name} mark={mark} tone={tone} />
        </div>
        <div className="flex flex-1 flex-col gap-3 pt-2">
          <div className="flex min-h-12 flex-col items-start gap-1">
            <h3 className="text-sm font-semibold leading-4">{name}</h3>
            <Badge variant="outline" className={`px-1.5 py-0 text-[10px] leading-4 ${builtIn ? "border-map-accent/30 bg-map-accent/10 text-map-accent" : configured ? "border-success/30 bg-success/10 text-success" : "text-muted-foreground"}`}>
              {builtIn ? "Built in" : configured ? "Configured" : "Not connected"}
            </Badge>
          </div>
          <p className="min-h-8 text-xs leading-4 text-muted-foreground">{description}</p>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">Provides</p>
            <ul className="space-y-1.5 text-xs">
              {providerCapabilityRows(provides).map(({ label, supported }) => <li key={label} className={`flex items-center gap-1.5 ${supported ? "text-foreground" : "text-muted-foreground"}`}><span aria-label={supported ? "Supported" : "Not supported"}>{supported ? <Check className="h-3.5 w-3.5 shrink-0 text-success" /> : <Minus className="h-3.5 w-3.5 shrink-0" />}</span><span>{label}</span></li>)}
            </ul>
          </div>
          <div className="mt-auto min-h-8">
            {usedFor.length > 0 && <p className="text-[10px] leading-4 text-success"><span className="font-semibold">Used for: </span>{usedFor.join(" · ")}</p>}
          </div>
          <div className="border-t pt-2">
            {builtIn ? <span className="flex h-9 items-center justify-center gap-1.5 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" />No setup required</span> : <Button variant={name === "MAIT iNTELLiWeb" && !configured ? "default" : "outline"} size="sm" className="h-9 w-full justify-center gap-1.5 text-xs" onClick={() => setOpen(true)} aria-label={`${configured ? "Configure" : "Connect"} ${name}`}>{name === "MAIT iNTELLiWeb" && !configured ? <><ArrowRight className="h-3.5 w-3.5" />Connect MAIT</> : <><Settings2 className="h-3.5 w-3.5" />Configure</>}</Button>}
          </div>
        </div>
      </Card>
      {!builtIn && <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{name}</DialogTitle></DialogHeader>{children}</DialogContent></Dialog>}
    </>
  );
}