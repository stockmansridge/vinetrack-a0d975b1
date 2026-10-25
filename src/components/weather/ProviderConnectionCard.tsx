import { useState, type ReactNode } from "react";
import { Check, Settings2, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Summary presentation only; provider-owned hooks and actions stay in the caller. */
export function ProviderConnectionCard({ name, mark, icon, tone, description, configured, builtIn, provides, usedFor, children, id }: {
  name: string; mark: string; icon: ReactNode; tone: string; description: string;
  configured?: boolean; builtIn?: boolean; provides: string[]; usedFor: string[];
  children?: ReactNode; id?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card id={id} className="flex h-full min-h-80 min-w-0 scroll-mt-6 flex-col overflow-hidden rounded-lg shadow-sm">
        <div className={`flex h-20 shrink-0 items-center gap-3 border-b px-5 ${tone}`}>
          <span className="shrink-0">{icon}</span>
          <span className="break-words text-xl font-bold tracking-normal">{mark}</span>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold tracking-normal">{name}</h3>
            <Badge variant="outline" className={builtIn ? "border-map-accent/30 bg-map-accent/10 text-map-accent" : configured ? "border-success/30 bg-success/10 text-success" : "text-muted-foreground"}>
              {builtIn ? "Built in" : configured ? "Configured" : "Not connected"}
            </Badge>
          </div>
          <p className="min-h-10 text-sm leading-5 text-muted-foreground">{description}</p>
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Provides</p>
            <ul className="space-y-2 text-sm">
              {provides.map(value => <li key={value} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /><span>{value}</span></li>)}
            </ul>
          </div>
          <div className="mt-auto pt-2">
            {usedFor.length > 0 ? <p className="text-xs leading-5 text-success"><span className="font-semibold">Currently used for</span><br />{usedFor.join(" · ")}</p> : <p className="text-xs leading-5 text-muted-foreground">Not currently selected</p>}
          </div>
          <div className="border-t pt-3">
            {builtIn ? <span className="flex h-9 items-center gap-2 text-sm text-muted-foreground"><Check className="h-4 w-4" />No connection required</span> : <Button variant="outline" className="w-full justify-between" onClick={() => setOpen(true)} aria-label={`${configured ? "Configure" : "Connect"} ${name}`}><span>{configured ? "Configure" : "Connect"}</span>{configured ? <Settings2 className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}</Button>}
          </div>
        </div>
      </Card>
      {!builtIn && <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{name}</DialogTitle></DialogHeader>{children}</DialogContent></Dialog>}
    </>
  );
}