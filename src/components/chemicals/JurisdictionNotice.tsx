// Jurisdiction banner shown wherever a product's registration country may
// differ from the current vineyard's country.
//
// It never hides chemistry — actives, concentrations and FRAC/HRAC/IRAC groups
// stay visible. It states plainly that the foreign LABEL (registered uses,
// rates, WHP, re-entry, restrictions) is not authoritative here.
import { AlertTriangle, Globe } from "lucide-react";
import {
  jurisdictionNotice,
  type JurisdictionSuitability,
} from "@/lib/chemicalJurisdiction";

export function JurisdictionNoticeBanner({
  registrationCountry,
  vineyardCountry,
  className = "",
  dense,
}: {
  registrationCountry: unknown;
  vineyardCountry: unknown;
  className?: string;
  dense?: boolean;
}) {
  const notice = jurisdictionNotice(registrationCountry, vineyardCountry);
  if (notice.suitability === "compatible" || !notice.message) return null;
  const danger: JurisdictionSuitability = "mismatch";
  const tone =
    notice.suitability === danger
      ? "border-warning/50 bg-warning/10"
      : "border-border/60 bg-muted/40";
  const Icon = notice.suitability === danger ? AlertTriangle : Globe;
  return (
    <div className={`rounded border p-2 text-[11px] ${tone} ${className}`}>
      <div className="flex items-start gap-1.5">
        <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div className="space-y-0.5">
          <div className="font-medium">{notice.message}</div>
          {!dense && notice.action && (
            <div className="text-muted-foreground">{notice.action}</div>
          )}
          {!dense && (
            <div className="text-muted-foreground">
              Chemistry (actives, concentrations, resistance groups) is retained. Rates,
              withholding and re-entry from a foreign label are not authoritative here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
