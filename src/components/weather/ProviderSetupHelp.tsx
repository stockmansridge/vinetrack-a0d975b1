import { useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/** Presentation-only help; never mounts provider forms or performs requests. */
export function ProviderSetupHelp({ label, title, intro, children }: { label: string; title: string; intro: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <>
    <TooltipProvider><Tooltip><TooltipTrigger asChild>
      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" aria-label={label} onClick={() => setOpen(true)}><HelpCircle className="h-4 w-4" /></Button>
    </TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip></TooltipProvider>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle className="pr-6">{title}</DialogTitle><DialogDescription>{intro}</DialogDescription></DialogHeader>
      <div className="space-y-5 text-sm leading-6">{children}</div>
    </DialogContent></Dialog>
  </>;
}