// System Admin Master Chemical curation drawer.
//
// A compact review panel, not a chemical editor: open the label, fill the gaps,
// Save & Next. It writes through the existing Master review mechanism
// (`master_review_correct` for corrections, `review_status` for approval) and
// never invents a value to satisfy approval. `registered_uses` is deliberately
// absent — it is evidence, not a field this workflow requires.
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, ChevronLeft, ChevronRight, ExternalLink, Plus, Save, Trash2 } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { masterChemicalDraft, setMasterReviewStatus, type MasterChemicalRow } from "@/lib/masterChemicals";
import {
  MASTER_CORE_FIELD_LABEL,
  MASTER_RATE_BASIS_LABEL,
  MASTER_RATE_BASIS_SUFFIX,
  MASTER_RATE_UNITS,
  masterLabelTargets,
  masterMissingFields,
  masterRateProblems,
  masterRatesForBasis,
  newMasterRate,
  parseMasterViticultureRates,
  removeMasterRate,
  saveMasterCuration,
  setMasterRateKind,
  upsertMasterRate,
  type MasterRateBasis,
  type MasterViticultureRate,
  type MasterCurationIdentity,
} from "@/lib/masterCuration";

const numOrNull = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const txt = (v: unknown) => (v == null ? "" : String(v));

export interface MasterCurationDrawerProps {
  row: MasterChemicalRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Position in the current filtered queue, for the Previous/Next controls. */
  position?: { index: number; total: number };
  hasPrevious?: boolean;
  hasNext?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  /** Called after any successful write so the list can refresh. */
  onSaved?: () => void;
  /** Move to the next record still needing attention (Approve & Next). */
  onNextAttention?: () => void;
}

export function MasterCurationDrawer(props: MasterCurationDrawerProps) {
  const { row, open, onOpenChange } = props;
  const [identity, setIdentity] = useState<MasterCurationIdentity>({});
  const [rates, setRates] = useState<MasterViticultureRate[]>([]);
  const [reason, setReason] = useState("");

  // Re-seed whenever a different record is opened.
  useEffect(() => {
    if (!row) return;
    setIdentity({
      registered_product_name: txt(row.registered_product_name),
      registration_number: txt(row.registration_number),
      registrant: txt(row.registrant),
      product_category: txt(row.product_category),
      form_type: txt(row.form_type),
      label_reference: txt(row.label_reference),
    });
    setRates(parseMasterViticultureRates(row.viticulture_rates));
    setReason("");
    setConfirmApprove(false);
  }, [row?.id]);

  const draft = useMemo(() => (row ? masterChemicalDraft(row) : null), [row]);
  const labels = useMemo(() => (row ? masterLabelTargets(row) : []), [row]);
  const missing = useMemo(() => (row ? masterMissingFields(row) : []), [row]);

  const save = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("No record selected.");
      const res = await saveMasterCuration({ row, identity, rates, reason });
      if (res.outcome !== "ok") throw new Error(res.message);
      return res;
    },
  });

  const approve = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("No record selected.");
      const res = await saveMasterCuration({ row, identity, rates, reason });
      if (res.outcome !== "ok") throw new Error(res.message);
      await setMasterReviewStatus(row.id, "approved", reason || null);
    },
  });

  const busy = save.isPending || approve.isPending;

  const runSave = async (then?: () => void) => {
    try {
      const res = await save.mutateAsync();
      toast({ title: "Saved", description: res.message });
      props.onSaved?.();
      then?.();
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message ?? String(e), variant: "destructive" });
    }
  };

  const runApprove = async () => {
    try {
      await approve.mutateAsync();
      toast({ title: "Approved" });
      props.onSaved?.();
      setConfirmApprove(false);
      props.onNextAttention?.();
    } catch (e: any) {
      toast({ title: "Not approved", description: e?.message ?? String(e), variant: "destructive" });
    }
  };

  const setRate = (next: MasterViticultureRate) => setRates((rs) => upsertMasterRate(rs, next));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        {!row ? null : (
          <>
            <SheetHeader className="space-y-2">
              <SheetTitle className="text-base">
                {row.registered_product_name?.trim() || "Unnamed product"}
              </SheetTitle>
              <SheetDescription className="text-xs">
                {props.position
                  ? `Record ${props.position.index + 1} of ${props.position.total} in this queue. `
                  : ""}
                Corrections are recorded as manual admin entry, never as official evidence.
              </SheetDescription>

              {/* Label access — the first thing an admin needs. */}
              <div className="flex flex-wrap items-center gap-2">
                {labels.length === 0 ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5" /> No label link on this record
                  </span>
                ) : (
                  labels.slice(0, 3).map((t, i) => (
                    <Button key={t.url} asChild size="sm" variant={i === 0 ? "default" : "outline"}>
                      <a href={t.url} target="_blank" rel="noopener noreferrer">
                        {i === 0 ? "Open Label" : t.label} <ExternalLink className="h-3.5 w-3.5 ml-1" />
                      </a>
                    </Button>
                  ))
                )}
              </div>

              {missing.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {missing.map((f) => (
                    <Badge key={f} variant="outline" className="text-[10px] border-orange-500/40 text-orange-600">
                      Missing {MASTER_CORE_FIELD_LABEL[f]}
                    </Badge>
                  ))}
                </div>
              )}
            </SheetHeader>

            <div className="mt-4 space-y-5 text-sm">
              {/* ------------------------------------------------ identity */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Identity
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Registered product name *">
                    <Input
                      value={txt(identity.registered_product_name)}
                      onChange={(e) => setIdentity((s) => ({ ...s, registered_product_name: e.target.value }))}
                    />
                  </Field>
                  <Field label="APVMA registration number *">
                    <Input
                      value={txt(identity.registration_number)}
                      onChange={(e) => setIdentity((s) => ({ ...s, registration_number: e.target.value }))}
                    />
                  </Field>
                  <Field label="Registrant / manufacturer">
                    <Input
                      value={txt(identity.registrant)}
                      onChange={(e) => setIdentity((s) => ({ ...s, registrant: e.target.value }))}
                    />
                  </Field>
                  <Field label="Category *">
                    <Input
                      placeholder="fungicide, insecticide, herbicide…"
                      value={txt(identity.product_category)}
                      onChange={(e) => setIdentity((s) => ({ ...s, product_category: e.target.value }))}
                    />
                  </Field>
                  <Field label="Form / type">
                    <Input
                      placeholder="SC, WG, EC…"
                      value={txt(identity.form_type)}
                      onChange={(e) => setIdentity((s) => ({ ...s, form_type: e.target.value }))}
                    />
                  </Field>
                  <Field label="Label link">
                    <Input
                      placeholder="https://…"
                      value={txt(identity.label_reference)}
                      onChange={(e) => setIdentity((s) => ({ ...s, label_reference: e.target.value }))}
                    />
                  </Field>
                </div>
              </section>

              {/* --------------------------------------- active ingredients */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Active ingredients
                </h3>
                {draft && draft.actives.length > 0 ? (
                  <div className="rounded-md border border-border/60 divide-y divide-border/60 text-xs">
                    {draft.actives.map((a, i) => (
                      <div key={i} className="px-3 py-2 flex items-center justify-between gap-2">
                        <span className="font-medium">{a.name || "Unnamed active"}</span>
                        <span className="text-muted-foreground">
                          {a.concentration != null
                            ? `${a.concentration} ${a.concentration_unit ?? ""}`.trim()
                            : "No concentration"}
                          {a.activity_group?.code ? ` · ${a.activity_group.code}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    No active ingredients recorded.
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Active ingredients and activity groups are typed evidence. The shared backend has no
                  manual handler for them, so they are shown read-only here and filled by an APVMA
                  refresh — nothing is invented.
                </p>
              </section>

              {/* --------------------------------------- viticulture rates */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Registered vineyard rates
                </h3>
                {(["per_hectare", "per_100_litres"] as MasterRateBasis[]).map((basis) => (
                  <div key={basis} className="rounded-md border border-border/60">
                    <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
                      <span className="text-xs font-semibold">{MASTER_RATE_BASIS_LABEL[basis]}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRates((rs) => [...rs, newMasterRate(basis)])}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add rate
                      </Button>
                    </div>
                    <div className="divide-y divide-border/60">
                      {masterRatesForBasis(rates, basis).length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                          No {MASTER_RATE_BASIS_SUFFIX[basis]} rate recorded.
                        </div>
                      ) : (
                        masterRatesForBasis(rates, basis).map((r) => (
                          <RateRow
                            key={r.id}
                            rate={r}
                            onChange={setRate}
                            onDelete={() => setRates((rs) => removeMasterRate(rs, r.id))}
                          />
                        ))
                      )}
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  Registered Master rates only. A /ha rate is never converted to /100 L, separate label
                  options stay separate, and these never become a vineyard's operational default rate.
                </p>
              </section>

              <Field label="Reason / review note">
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>

            {confirmApprove && (
              <div className="mt-4 rounded-md border border-orange-500/40 bg-orange-500/5 p-3 text-xs space-y-2">
                <div className="font-semibold">Still missing on this record</div>
                <ul className="list-disc pl-4">
                  {missing.map((f) => (
                    <li key={f}>{MASTER_CORE_FIELD_LABEL[f]}</li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={runApprove}>
                    Approve anyway & next
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmApprove(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* --------------------------------------------------- controls */}
            <div className="sticky bottom-0 mt-4 -mx-6 border-t border-border/60 bg-background px-6 py-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={!props.hasPrevious || busy}
                onClick={props.onPrevious}
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <Button size="sm" variant="ghost" disabled={!props.hasNext || busy} onClick={props.onNext}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
              <div className="flex-1" />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => runSave()}>
                <Save className="h-4 w-4 mr-1" /> Save
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => runSave(props.onNext)}>
                Save &amp; Next
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => (missing.length ? setConfirmApprove(true) : runApprove())}
              >
                <BadgeCheck className="h-4 w-4 mr-1" /> Approve &amp; Next
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function RateRow({
  rate,
  onChange,
  onDelete,
}: {
  rate: MasterViticultureRate;
  onChange: (next: MasterViticultureRate) => void;
  onDelete: () => void;
}) {
  const problems = masterRateProblems(rate);
  return (
    <div className="px-3 py-2 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-[110px]">
          <Label className="text-[11px] text-muted-foreground">Type</Label>
          <Select
            value={rate.kind}
            onValueChange={(v) => onChange(setMasterRateKind(rate, v as "single" | "range"))}
          >
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="single">Single</SelectItem>
              <SelectItem value="range">Range</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {rate.kind === "single" ? (
          <div className="w-[100px]">
            <Label className="text-[11px] text-muted-foreground">Rate *</Label>
            <Input
              inputMode="decimal"
              value={rate.value == null ? "" : String(rate.value)}
              onChange={(e) => onChange({ ...rate, value: numOrNull(e.target.value) })}
            />
          </div>
        ) : (
          <>
            <div className="w-[90px]">
              <Label className="text-[11px] text-muted-foreground">Min *</Label>
              <Input
                inputMode="decimal"
                value={rate.min_value == null ? "" : String(rate.min_value)}
                onChange={(e) => onChange({ ...rate, min_value: numOrNull(e.target.value) })}
              />
            </div>
            <div className="w-[90px]">
              <Label className="text-[11px] text-muted-foreground">Max *</Label>
              <Input
                inputMode="decimal"
                value={rate.max_value == null ? "" : String(rate.max_value)}
                onChange={(e) => onChange({ ...rate, max_value: numOrNull(e.target.value) })}
              />
            </div>
          </>
        )}
        <div className="w-[90px]">
          <Label className="text-[11px] text-muted-foreground">Unit *</Label>
          <Select value={rate.unit || undefined} onValueChange={(v) => onChange({ ...rate, unit: v as any })}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Unit" /></SelectTrigger>
            <SelectContent>
              {MASTER_RATE_UNITS.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                  {MASTER_RATE_BASIS_SUFFIX[rate.basis]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="icon" variant="ghost" onClick={onDelete} aria-label="Delete rate">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <Input
        placeholder="Label / condition text (optional)"
        value={txt(rate.label)}
        onChange={(e) => onChange({ ...rate, label: e.target.value || null })}
      />
      {problems.length > 0 && (
        <div className="text-[11px] text-orange-600">{problems.join(" ")}</div>
      )}
    </div>
  );
}
