// Stage 2B closeout — full product-identity re-verification UI.
//
// Re-verification never writes silently: it retrieves authoritative-style
// information for the strongest available product identity, shows a structured
// diff, and only changes the draft when the operator accepts it.
import { useState } from "react";
import { Loader2, ShieldCheck, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  type ChemicalIntelligenceDraft,
} from "@/lib/chemicalIntelligenceWrite";
import {
  type ReverifyCandidate,
  type ReverifyIdentity,
  type ReverifyResult,
  type ReverifySection,
  SECTION_LABEL,
  resolveReverifyIdentity,
  reverifyChemical,
} from "@/lib/chemicalReverify";

const SECTIONS: ReverifySection[] = ["chemistry", "registration", "uses"];

async function defaultLookup(identity: ReverifyIdentity): Promise<ReverifyCandidate[]> {
  const { data, error } = await supabase.functions.invoke("chemical-ai-lookup", {
    body: { product_name: identity.query, country: identity.country ?? null },
  });
  if (error) {
    const serverMsg = (data as any)?.error;
    throw new Error(typeof serverMsg === "string" && serverMsg ? serverMsg : error.message);
  }
  const list = Array.isArray((data as any)?.candidates)
    ? (data as any).candidates
    : (data as any)?.suggestion
    ? [(data as any).suggestion]
    : [];
  return list as ReverifyCandidate[];
}

const OUTCOME_UI = {
  current: { icon: CheckCircle2, cls: "bg-primary/15 text-primary", label: "Current" },
  updated: { icon: ShieldCheck, cls: "bg-warning/20 text-warning-foreground", label: "Updated information" },
  needs_review: { icon: AlertTriangle, cls: "bg-warning/20 text-warning-foreground", label: "Needs review" },
  failed: { icon: XCircle, cls: "bg-destructive/15 text-destructive", label: "Could not re-verify" },
} as const;

export function ChemicalReverifyDialog({
  open,
  onOpenChange,
  draft,
  productName,
  country,
  onAccept,
  lookup = defaultLookup,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draft: ChemicalIntelligenceDraft;
  productName?: string | null;
  country?: string | null;
  onAccept: (next: ChemicalIntelligenceDraft) => void;
  lookup?: (identity: ReverifyIdentity) => Promise<ReverifyCandidate[]>;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReverifyResult | null>(null);
  const identity = resolveReverifyIdentity(draft, productName, country);

  const run = async () => {
    setRunning(true);
    setResult(null);
    const r = await reverifyChemical({ draft, productName, country, lookup });
    setResult(r);
    setRunning(false);
  };

  const ui = result ? OUTCOME_UI[result.outcome] : null;
  const Icon = ui?.icon ?? ShieldCheck;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setResult(null); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Re-verify chemical</DialogTitle>
          <DialogDescription>
            Looks up the full product identity — registration, chemistry, registered uses,
            rates, withholding and re-entry periods. Nothing is changed until you accept.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border/60 p-3">
            <div className="text-xs text-muted-foreground">Identity used</div>
            <div className="font-medium">
              {identity ? identity.description : "No product identity available"}
            </div>
            {!identity && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Add a product name or registration number before re-verifying.
              </p>
            )}
          </div>

          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className={`border-transparent gap-1 ${ui!.cls}`}>
                  <Icon className="h-3.5 w-3.5" /> {ui!.label}
                </Badge>
                <span className="font-medium">{result.title}</span>
              </div>
              <p className="text-xs text-muted-foreground">{result.detail}</p>

              {result.diff.length > 0 && SECTIONS.map((section) => {
                const rows = result.diff.filter((d) => d.section === section);
                if (!rows.length) return null;
                return (
                  <div key={section} className="rounded-md border border-border/60">
                    <div className="border-b border-border/60 px-3 py-1.5 text-xs font-semibold">
                      {SECTION_LABEL[section]}
                    </div>
                    <div className="divide-y divide-border/60">
                      {rows.map((d, i) => (
                        <div key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 text-xs">
                          <div className="col-span-3 font-medium">{d.label}</div>
                          <div className="text-muted-foreground line-through">{d.before}</div>
                          <div className="text-muted-foreground">→</div>
                          <div className="font-medium">{d.after}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="button" variant="outline" disabled={!identity || running} onClick={run}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {result ? "Run again" : "Re-verify"}
          </Button>
          {result?.proposed && (result.outcome === "updated" || result.outcome === "needs_review" || result.outcome === "current") && (
            <Button
              type="button"
              onClick={() => {
                onAccept(result.proposed!);
                onOpenChange(false);
                setResult(null);
              }}
            >
              {result.outcome === "current" ? "Accept refreshed evidence" : "Accept changes"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
