// Read-only Chemical Detail (SQL 194 Chemical Intelligence).
//
// Content parity with the iOS/Android chemical detail screen: identity,
// Active Ingredients, Registered Uses (with per-use rate, basis, conditions,
// Withholding Period, Re-entry Interval and verbatim Restrictions),
// Product Information and Sources / Documents.
//
// Safety rules are enforced by `chemicalSafetyDisplay` — a missing period is
// never rendered as zero and a missing restriction is never "No restrictions".
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, ExternalLink, FileText, Globe } from "lucide-react";
import {
  formatActivityGroup, formatLabelRate, toChemicalIntelligence,
  type ChemicalIntelligence, type RegisteredUse,
} from "@/lib/chemicalIntelligence";
import {
  NOT_RESOLVED_LABEL,
  reEntryDisplayForUse,
  restrictionsDisplayForUse,
  withholdingDisplayForUse,
} from "@/lib/chemicalSafetyDisplay";
import { VerificationBadge, ActivityGroupSummary } from "./ChemicalIntelligenceBadges";

const dash = (v: unknown) => (v == null || v === "" ? "—" : String(v));

const isUrl = (v?: string | null): v is string => !!v && /^https?:\/\//i.test(v);

/** Every label rate for a use, in label order. Ranges are never merged. */
function useRateText(use: RegisteredUse): string {
  const rates = use.rates.length
    ? use.rates.map((r) => formatLabelRate(r)).filter(Boolean)
    : [formatLabelRate(use.rate)].filter(Boolean);
  if (rates.length) return rates.join(" · ");
  return use.rateText ?? NOT_RESOLVED_LABEL;
}

function useConditionText(use: RegisteredUse): string | null {
  const conditions = use.rates
    .map((r) => r.condition)
    .filter((c): c is string => !!c);
  return conditions.length ? Array.from(new Set(conditions)).join(" · ") : null;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}


export function ChemicalIntelligenceDetail({ chem }: { chem: ChemicalIntelligence }) {
  const { product, verification } = chem;
  return (
    <div className="space-y-5">
      {verification.status === "conflict" && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
          <div>
            <div className="font-medium">Conflicting label information</div>
            <div className="text-muted-foreground">
              Sources disagree about this product. Resolution is not available in the portal yet.
            </div>
          </div>
        </div>
      )}
      {verification.status === "needs_match" && (
        <div className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
          <div>
            <div className="font-medium">Needs match</div>
            <div className="text-muted-foreground">
              This product has not been matched to a registered label yet.
            </div>
          </div>
        </div>
      )}

      <Section title="Product">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" value={dash(chem.name)} />
          <Field label="Registered product name" value={dash(product.registeredProductName)} />
          <Field label="Country" value={dash(product.country)} />
          <Field
            label="Registration"
            value={
              product.registrationNumber || product.registrationScheme
                ? `${product.registrationScheme ?? ""} ${product.registrationNumber ?? ""}`.trim()
                : "—"
            }
          />
          <Field label="Registrant" value={dash(product.registrant)} />
          <Field label="Manufacturer" value={dash(product.manufacturer)} />
          {product.labelReference && <Field label="Label reference" value={product.labelReference} />}
          {product.labelVersion && <Field label="Label version" value={product.labelVersion} />}
        </div>
      </Section>

      <Separator />

      <Section title="Active ingredients">
        {chem.actives.length ? (
          <ul className="space-y-1 text-sm">
            {chem.actives.map((a, i) => (
              <li key={`${a.name ?? "active"}-${i}`} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{dash(a.name)}</span>
                {a.concentration != null && (
                  <span className="text-muted-foreground">
                    {a.concentration}
                    {a.unit ? ` ${a.unit}` : ""}
                  </span>
                )}
                {a.group && <Badge variant="secondary">{formatActivityGroup(a.group)}</Badge>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Structured actives unavailable.
            {chem.legacy.activeIngredient ? ` Legacy value: ${chem.legacy.activeIngredient}` : ""}
          </p>
        )}
        <div className="pt-1">
          <ActivityGroupSummary chem={chem} />
        </div>
      </Section>

      <Separator />

      <Section title="Registered Uses">
        {chem.registeredUses.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 text-left">Crop / use</th>
                  <th className="py-1 pr-3 text-left">Target</th>
                  <th className="py-1 pr-3 text-left">Rate</th>
                  <th className="py-1 pr-3 text-left">Withholding Period</th>
                  <th className="py-1 text-left">Re-entry Interval</th>
                </tr>
              </thead>
              <tbody>
                {chem.registeredUses.map((u, i) => {
                  const conditions = useConditionText(u);
                  const restrictions = restrictionsDisplayForUse(u);
                  return (
                    <tr key={`use-${i}`} className="border-t align-top">
                      <td className="py-1.5 pr-3">{dash(u.crop)}</td>
                      <td className="py-1.5 pr-3">{dash(u.target)}</td>
                      <td className="py-1.5 pr-3">
                        <div>{useRateText(u)}</div>
                        {conditions && (
                          <div className="text-xs text-muted-foreground">{conditions}</div>
                        )}
                        {restrictions && (
                          <details className="text-xs text-muted-foreground">
                            <summary className="cursor-pointer">Restrictions for this use</summary>
                            <p className="whitespace-pre-wrap pt-1">{restrictions}</p>
                          </details>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">{withholdingDisplayForUse(u)}</td>
                      <td className="py-1.5">{reEntryDisplayForUse(u)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No registered uses recorded for this chemical.
          </p>
        )}
        {chem.labelRateBases.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Label rate bases: {chem.labelRateBases.join(", ")}
          </p>
        )}
      </Section>

      <Separator />

      <Section title="Restrictions">
        {chem.legacy.restrictions ? (
          <p className="whitespace-pre-wrap text-sm">{chem.legacy.restrictions}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No product-level restrictions recorded. Always check the current product label.
          </p>
        )}
      </Section>

      <Separator />

      <Section title="Sources / Documents">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <VerificationBadge status={verification.status} />
          {verification.verifiedAt && (
            <span className="text-muted-foreground">
              Last verified {new Date(verification.verifiedAt).toLocaleDateString()}
            </span>
          )}
        </div>
        <ul className="space-y-1 text-sm">
          {isUrl(product.labelUrl) && (
            <li>
              <a
                href={product.labelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <FileText className="h-3 w-3" />
                Product label / SDS
              </a>
            </li>
          )}
          {isUrl(product.labelReference) && (
            <li>
              <a
                href={product.labelReference}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Registered label reference
              </a>
            </li>
          )}
          {isUrl(product.productUrl) && (
            <li>
              <a
                href={product.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary hover:underline"
                title="Manufacturer / distributor product page — not the official label"
              >
                <Globe className="h-3 w-3" />
                Manufacturer product page
              </a>
            </li>
          )}
          {verification.sources.map((s, i) => (
            <li key={`src-${i}`}>
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {s.label ?? s.url}
                </a>
              ) : (
                <span>{s.label}</span>
              )}
              {s.retrievedAt && (
                <span className="text-muted-foreground"> · {s.retrievedAt}</span>
              )}
            </li>
          ))}
        </ul>
        {!isUrl(product.labelUrl) &&
          !isUrl(product.labelReference) &&
          !isUrl(product.productUrl) &&
          verification.sources.length === 0 && (
            <p className="text-sm text-muted-foreground">No source documents recorded.</p>
          )}
        {verification.conflicts.length > 0 && (
          <div className="text-sm">
            <div className="font-medium text-destructive">Conflicts</div>
            <ul className="list-disc pl-5 text-muted-foreground">
              {verification.conflicts.map((c, i) => <li key={`c-${i}`}>{c}</li>)}
            </ul>
          </div>
        )}
        {verification.unresolvedFields.length > 0 && (
          <div className="text-sm">
            <div className="font-medium">Unresolved</div>
            <div className="text-muted-foreground">{verification.unresolvedFields.join(", ")}</div>
          </div>
        )}
      </Section>


      <Separator />

      <Section title="Commercial / inventory">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Default rate" value={dash(chem.commercial.preferredRatePerHa)} />
          <Field label="Unit" value={dash(chem.commercial.unit)} />
          <Field label="Pack size" value={dash(chem.commercial.packSize)} />
          <Field
            label="Cost / unit"
            value={
              chem.commercial.costPerUnit == null
                ? "—"
                : `${chem.commercial.currency} ${chem.commercial.costPerUnit}`
            }
          />
          <Field label="Supplier" value={dash(chem.commercial.supplier)} />
          <Field label="Notes" value={dash(chem.commercial.notes)} />
        </div>
      </Section>

      {!chem.structured && (
        <p className="text-xs text-muted-foreground">
          Structured chemical intelligence unavailable for this product — legacy values shown.
        </p>
      )}
    </div>
  );
}

export function ChemicalIntelligenceDialog({
  row,
  open,
  onOpenChange,
}: {
  row: Record<string, any> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const chem = row ? toChemicalIntelligence(row) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{chem?.name ?? "Chemical"}</DialogTitle>
          <DialogDescription>Chemical intelligence (read-only)</DialogDescription>
        </DialogHeader>
        {chem && <ChemicalIntelligenceDetail chem={chem} />}
      </DialogContent>
    </Dialog>
  );
}
