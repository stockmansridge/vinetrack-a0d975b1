// Read-only Chemical Intelligence detail (SQL 194). Stage 2A: no write,
// verify or resolve actions — those land in Stage 2B.
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, ExternalLink } from "lucide-react";
import {
  formatActivityGroup, formatLabelRate, toChemicalIntelligence,
  type ChemicalIntelligence,
} from "@/lib/chemicalIntelligence";
import { VerificationBadge, ActivityGroupSummary } from "./ChemicalIntelligenceBadges";

const dash = (v: unknown) => (v == null || v === "" ? "—" : String(v));

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
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

      <Section title="Label rates">
        {chem.labelRateBases.length || chem.registeredUses.some((u) => u.rate || u.rateText) ? (
          <ul className="space-y-1 text-sm">
            {chem.labelRateBases.map((b) => (
              <li key={b} className="text-muted-foreground">Basis: {b}</li>
            ))}
            {chem.registeredUses.map((u, i) => {
              const rate = formatLabelRate(u.rate) ?? u.rateText;
              return rate ? (
                <li key={`rate-${i}`}>
                  {rate}
                  {u.crop ? <span className="text-muted-foreground"> · {u.crop}</span> : null}
                </li>
              ) : null;
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No structured label rates recorded.</p>
        )}
      </Section>

      <Separator />

      <Section title="Registered uses">
        {chem.registeredUses.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-1 text-left">Crop</th>
                  <th className="py-1 text-left">Target</th>
                  <th className="py-1 text-left">Rate</th>
                  <th className="py-1 text-left">WHP</th>
                  <th className="py-1 text-left">Re-entry</th>
                </tr>
              </thead>
              <tbody>
                {chem.registeredUses.map((u, i) => (
                  <tr key={`use-${i}`} className="border-t">
                    <td className="py-1">{dash(u.crop)}</td>
                    <td className="py-1">{dash(u.target)}</td>
                    <td className="py-1">{dash(formatLabelRate(u.rate) ?? u.rateText)}</td>
                    <td className="py-1">{dash(u.withholdingPeriod)}</td>
                    <td className="py-1">{dash(u.reEntryPeriod)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No registered uses recorded.</p>
        )}
      </Section>

      <Separator />

      <Section title="Verification">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <VerificationBadge status={verification.status} />
          {verification.verifiedAt && (
            <span className="text-muted-foreground">
              Last verified {new Date(verification.verifiedAt).toLocaleDateString()}
            </span>
          )}
        </div>
        {verification.sources.length > 0 && (
          <ul className="space-y-1 text-sm">
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
