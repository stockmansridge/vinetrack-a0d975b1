// Stage 2B — structured Chemical Intelligence editor (sql/194 write model).
//
// The operator edits the DRAFT; the canonical encoder derives every stored
// column. Verification status is previewed live from the evidence actually
// present, so the UI can never promise a confidence the data doesn't support.
import { useMemo } from "react";
import { Plus, Trash2, AlertTriangle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  type ChemicalIntelligenceDraft,
  type WriteActiveIngredient,
  type WriteRegisteredUse,
  type WriteLabelRate,
  type WriteDataSource,
  type ConcentrationUnit,
  type LabelRateBasis,
  CONCENTRATION_UNITS,
  DATA_SOURCE_KINDS,
  DATA_SOURCE_KIND_LABEL,
  LABEL_RATE_BASES,
  LABEL_RATE_BASIS_LABEL,
  REGISTRATION_SCHEMES,
  REGISTRATION_SCHEME_LABEL,
  WRITE_SCHEMES,
  WRITE_SCHEME_LABEL,
  canonicalActivityGroups,
  isRangeBasis,
  normaliseDataSourceKind,
  normaliseGroupCode,
  normaliseRegistrationScheme,
  normaliseWriteScheme,
  reconcileConflicts,
  resolveVerificationStatus,
  suggestActivityGroup,
  activityGroupReferenceSource,
  withSource,
} from "@/lib/chemicalIntelligenceWrite";
import { VERIFICATION_LABEL } from "@/lib/chemicalIntelligence";

const STATUS_CLASS: Record<string, string> = {
  verified: "border-transparent bg-primary/15 text-primary",
  partially_verified: "border-transparent bg-warning/20 text-warning-foreground",
  conflict: "border-transparent bg-destructive text-destructive-foreground",
  needs_match: "border-transparent bg-warning/20 text-warning-foreground",
  unverified: "border-transparent bg-muted text-muted-foreground",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function ChemicalIntelligenceEditor({
  draft,
  onChange,
  disabled,
  productName,
  country,
}: {
  draft: ChemicalIntelligenceDraft;
  onChange: (next: ChemicalIntelligenceDraft) => void;
  disabled?: boolean;
  /** Product name used to resolve the re-verification identity. */
  productName?: string | null;
  country?: string | null;
}) {
  const [reverifyOpen, setReverifyOpen] = useState(false);
  const preview = useMemo(() => {
    const withConflicts = { ...draft, conflicts: reconcileConflicts(draft) };
    return {
      status: resolveVerificationStatus(withConflicts),
      conflicts: withConflicts.conflicts,
      groups: canonicalActivityGroups(draft.actives),
    };
  }, [draft]);

  const patch = (p: Partial<ChemicalIntelligenceDraft>) => onChange({ ...draft, ...p });

  const setActive = (i: number, next: Partial<WriteActiveIngredient>) =>
    patch({ actives: draft.actives.map((a, idx) => (idx === i ? { ...a, ...next } : a)) });

  const addActive = () =>
    patch({
      actives: [...draft.actives, { name: "", identity_source: "manual_entry" }],
    });

  const removeActive = (i: number) =>
    patch({ actives: draft.actives.filter((_, idx) => idx !== i) });

  const setUse = (i: number, next: Partial<WriteRegisteredUse>) =>
    patch({ registeredUses: draft.registeredUses.map((u, idx) => (idx === i ? { ...u, ...next } : u)) });

  const setRate = (ui: number, ri: number, next: Partial<WriteLabelRate>) =>
    setUse(ui, {
      rates: draft.registeredUses[ui].rates.map((r, idx) => (idx === ri ? { ...r, ...next } : r)),
    });

  const setSource = (i: number, next: Partial<WriteDataSource>) =>
    patch({ sources: draft.sources.map((s, idx) => (idx === i ? { ...s, ...next } : s)) });

  return (
    <div className="rounded-md border border-border/60 p-3 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">Chemical intelligence</h4>
          <p className="text-[11px] text-muted-foreground">
            Structured chemistry shared with the VineTrack mobile apps. Used for resistance
            management — the legacy text fields are generated from this.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={disabled}
            onClick={() => setReverifyOpen(true)}
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Re-verify
          </Button>
          <Badge className={STATUS_CLASS[preview.status]}>{VERIFICATION_LABEL[preview.status]}</Badge>
        </div>
      </div>

      <ChemicalReverifyDialog
        open={reverifyOpen}
        onOpenChange={setReverifyOpen}
        draft={draft}
        productName={productName}
        country={country}
        onAccept={onChange}
      />


      {preview.conflicts.length > 0 && (
        <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px]">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <div className="space-y-1">
            {preview.conflicts.map((c, i) => (
              <div key={i}>
                <strong>{c.active_ingredient_name ?? c.field}</strong>: entered {c.extracted_value},
                reference says {c.authoritative_value}. Saved as a recorded conflict — nothing is
                overwritten.
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ actives */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Active ingredients</Label>
          {preview.groups.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              Groups: {WRITE_SCHEME_LABEL[preview.groups[0].scheme]}{" "}
              {preview.groups.map((g) => g.code).join(" + ")}
            </span>
          )}
        </div>
        {draft.actives.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            No structured actives yet. Add each active so resistance grouping works.
          </p>
        )}
        {draft.actives.map((a, i) => (
          <div key={i} className="rounded-md border border-border/50 p-2 space-y-2">
            <div className="flex gap-2">
              <Input
                className="flex-1"
                placeholder="Active ingredient name"
                value={a.name}
                disabled={disabled}
                onChange={(e) => setActive(i, { name: e.target.value })}
                onBlur={() => {
                  if (!a.activity_group) {
                    const s = suggestActivityGroup(a.name);
                    if (s) setActive(i, { activity_group: s, group_source: "authoritative_classification" });
                  }
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={disabled}
                onClick={() => removeActive(i)}
                aria-label="Remove active ingredient"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                placeholder="Concentration"
                value={a.concentration ?? ""}
                disabled={disabled}
                onChange={(e) =>
                  setActive(i, {
                    concentration: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
              />
              <Select
                value={a.concentration_unit ?? ""}
                disabled={disabled}
                onValueChange={(v) => setActive(i, { concentration_unit: v as ConcentrationUnit })}
              >
                <SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger>
                <SelectContent>
                  {CONCENTRATION_UNITS.map((u) => (<SelectItem key={u} value={u}>{u}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Select
                value={a.activity_group?.scheme ?? "not_applicable"}
                disabled={disabled}
                onValueChange={(v) =>
                  setActive(i, {
                    activity_group: {
                      scheme: normaliseWriteScheme(v),
                      code: a.activity_group?.code ?? "",
                      common_name: a.activity_group?.common_name,
                    },
                    group_source: a.group_source ?? "manual_entry",
                  })
                }
              >
                <SelectTrigger><SelectValue placeholder="Scheme" /></SelectTrigger>
                <SelectContent>
                  {WRITE_SCHEMES.map((s) => (
                    <SelectItem key={s} value={s}>{WRITE_SCHEME_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Group code"
                value={a.activity_group?.code ?? ""}
                disabled={disabled || a.activity_group?.scheme === "not_applicable"}
                onChange={(e) =>
                  setActive(i, {
                    activity_group: {
                      scheme: a.activity_group?.scheme ?? "frac",
                      code: normaliseGroupCode(e.target.value),
                      common_name: a.activity_group?.common_name,
                    },
                    group_source: "manual_entry",
                  })
                }
              />
              <Select
                value={a.group_source ?? "manual_entry"}
                disabled={disabled}
                onValueChange={(v) => setActive(i, { group_source: normaliseDataSourceKind(v) })}
              >
                <SelectTrigger><SelectValue placeholder="Group source" /></SelectTrigger>
                <SelectContent>
                  {DATA_SOURCE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>{DATA_SOURCE_KIND_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" className="gap-1" disabled={disabled} onClick={addActive}>
          <Plus className="h-3.5 w-3.5" /> Add active ingredient
        </Button>
      </div>

      {/* ------------------------------------------------------- registration */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Registration identity</Label>
        <div className="grid grid-cols-2 gap-2">
          <Row label="Country">
            <Input
              placeholder="AU"
              value={draft.registration.country ?? ""}
              disabled={disabled}
              onChange={(e) => patch({ registration: { ...draft.registration, country: e.target.value } })}
            />
          </Row>
          <Row label="Register">
            <Select
              value={draft.registration.scheme ?? ""}
              disabled={disabled}
              onValueChange={(v) =>
                patch({ registration: { ...draft.registration, scheme: normaliseRegistrationScheme(v) } })
              }
            >
              <SelectTrigger><SelectValue placeholder="Select register" /></SelectTrigger>
              <SelectContent>
                {REGISTRATION_SCHEMES.map((s) => (
                  <SelectItem key={s} value={s}>{REGISTRATION_SCHEME_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Registration number">
            <Input
              value={draft.registration.number ?? ""}
              disabled={disabled}
              onChange={(e) => patch({ registration: { ...draft.registration, number: e.target.value } })}
            />
          </Row>
          <Row label="Registrant">
            <Input
              value={draft.registration.registrant ?? ""}
              disabled={disabled}
              onChange={(e) => patch({ registration: { ...draft.registration, registrant: e.target.value } })}
            />
          </Row>
          <Row label="Registered product name">
            <Input
              value={draft.registration.registered_product_name ?? ""}
              disabled={disabled}
              onChange={(e) =>
                patch({ registration: { ...draft.registration, registered_product_name: e.target.value } })
              }
            />
          </Row>
          <Row label="Label version / date">
            <Input
              value={draft.registration.label_version ?? ""}
              disabled={disabled}
              onChange={(e) => patch({ registration: { ...draft.registration, label_version: e.target.value } })}
            />
          </Row>
        </div>
        <Row label="Label reference (link or citation)">
          <Input
            value={draft.registration.label_reference ?? ""}
            disabled={disabled}
            onChange={(e) => patch({ registration: { ...draft.registration, label_reference: e.target.value } })}
          />
        </Row>
      </div>

      {/* ----------------------------------------------------- registered uses */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Registered uses</Label>
        {draft.registeredUses.map((u, ui) => (
          <div key={ui} className="rounded-md border border-border/50 p-2 space-y-2">
            <div className="flex gap-2">
              <Input
                className="flex-1"
                placeholder="Crop (e.g. Grapevines)"
                value={u.crop}
                disabled={disabled}
                onChange={(e) => setUse(ui, { crop: e.target.value })}
              />
              <Input
                className="flex-1"
                placeholder="Target (label wording)"
                value={u.target_raw}
                disabled={disabled}
                onChange={(e) => setUse(ui, { target_raw: e.target.value })}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={disabled}
                aria-label="Remove registered use"
                onClick={() => patch({ registeredUses: draft.registeredUses.filter((_, i) => i !== ui) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {u.rates.map((r, ri) => (
              <div key={ri} className="grid grid-cols-4 gap-2">
                <Select
                  value={r.basis}
                  disabled={disabled}
                  onValueChange={(v) => setRate(ui, ri, { basis: v as LabelRateBasis })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LABEL_RATE_BASES.map((b) => (
                      <SelectItem key={b} value={b}>{LABEL_RATE_BASIS_LABEL[b]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isRangeBasis(r.basis) ? (
                  <>
                    <Input
                      type="number" step="any" placeholder="Min"
                      value={r.min_value ?? ""}
                      disabled={disabled}
                      onChange={(e) =>
                        setRate(ui, ri, { min_value: e.target.value === "" ? undefined : Number(e.target.value) })
                      }
                    />
                    <Input
                      type="number" step="any" placeholder="Max"
                      value={r.max_value ?? ""}
                      disabled={disabled}
                      onChange={(e) =>
                        setRate(ui, ri, { max_value: e.target.value === "" ? undefined : Number(e.target.value) })
                      }
                    />
                  </>
                ) : (
                  <Input
                    className="col-span-2"
                    type="number" step="any" placeholder="Rate"
                    value={r.value ?? ""}
                    disabled={disabled}
                    onChange={(e) =>
                      setRate(ui, ri, { value: e.target.value === "" ? undefined : Number(e.target.value) })
                    }
                  />
                )}
                <Input
                  placeholder="Unit (L/ha)"
                  value={r.unit}
                  disabled={disabled}
                  onChange={(e) => setRate(ui, ri, { unit: e.target.value })}
                />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <Row label="Withholding period (days)">
                <Input
                  type="number" step="1"
                  value={u.withholding_period_days ?? ""}
                  disabled={disabled}
                  onChange={(e) =>
                    setUse(ui, {
                      withholding_period_days: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                />
              </Row>
              <Row label="Re-entry period (hours)">
                <Input
                  type="number" step="1"
                  value={u.re_entry_period_hours ?? ""}
                  disabled={disabled}
                  onChange={(e) =>
                    setUse(ui, {
                      re_entry_period_hours: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                />
              </Row>
            </div>
            <Textarea
              rows={2}
              placeholder="Label restrictions for this use"
              value={u.restrictions ?? ""}
              disabled={disabled}
              onChange={(e) => setUse(ui, { restrictions: e.target.value })}
            />
            <Button
              type="button" size="sm" variant="ghost" className="gap-1"
              disabled={disabled}
              onClick={() =>
                setUse(ui, {
                  rates: [...u.rates, { label: "", basis: "per_hectare", unit: "L/ha" }],
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add rate
            </Button>
          </div>
        ))}
        <Button
          type="button" size="sm" variant="outline" className="gap-1"
          disabled={disabled}
          onClick={() =>
            patch({
              registeredUses: [
                ...draft.registeredUses,
                { crop: "", target_raw: "", rates: [{ label: "", basis: "per_hectare", unit: "L/ha" }] },
              ],
            })
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add registered use
        </Button>
      </div>

      {/* ------------------------------------------------------------ sources */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Evidence / sources</Label>
        <p className="text-[11px] text-muted-foreground">
          Only official registers, manufacturer labels and authoritative classifications can support
          a verified record.
        </p>
        {draft.sources.map((s, i) => (
          <div key={i} className="grid grid-cols-[150px,minmax(0,1fr),minmax(0,1fr),40px] gap-2">
            <Select
              value={s.kind}
              disabled={disabled}
              onValueChange={(v) => setSource(i, { kind: normaliseDataSourceKind(v) })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATA_SOURCE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>{DATA_SOURCE_KIND_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Source name"
              value={s.name}
              disabled={disabled}
              onChange={(e) => setSource(i, { name: e.target.value })}
            />
            <Input
              placeholder="Reference / URL"
              value={s.reference ?? ""}
              disabled={disabled}
              onChange={(e) => setSource(i, { reference: e.target.value })}
            />
            <Button
              type="button" size="icon" variant="ghost"
              disabled={disabled}
              aria-label="Remove source"
              onClick={() => patch({ sources: draft.sources.filter((_, idx) => idx !== i) })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button" size="sm" variant="outline" className="gap-1"
          disabled={disabled}
          onClick={() =>
            patch({
              sources: [
                ...draft.sources,
                { kind: "manual_entry", name: "", retrieved_at: new Date().toISOString() },
              ],
            })
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add source
        </Button>
      </div>

      <Row label="Unresolved fields (comma separated)">
        <Input
          placeholder="e.g. withholding_period_days"
          value={draft.unresolvedFields.join(", ")}
          disabled={disabled}
          onChange={(e) =>
            patch({
              unresolvedFields: e.target.value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            })
          }
        />
      </Row>

      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">Claimed status</Label>
        <Select
          value={draft.claimedStatus}
          disabled={disabled}
          onValueChange={(v) => patch({ claimedStatus: v as ChemicalIntelligenceDraft["claimedStatus"] })}
        >
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="verified">Claim verified</SelectItem>
            <SelectItem value="partially_verified">Partially verified</SelectItem>
            <SelectItem value="unverified">Unverified</SelectItem>
            <SelectItem value="needs_match">Needs match</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground">
          Saved as <strong>{VERIFICATION_LABEL[preview.status]}</strong> — the claim is downgraded
          when the evidence doesn't support it.
        </span>
      </div>
    </div>
  );
}
