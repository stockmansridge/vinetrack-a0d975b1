// Stage 4 — the Resistance Planner editor.
//
// Season → Disease → Blocks → History → Plan timeline → Live assessment.
// The plan stores intent only; every verdict on screen is recomputed by the
// Stage 3C engine from the CURRENT actual spray history each time it opens.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Info,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useVineyard } from "@/context/VineyardContext";
import { useVintage } from "@/lib/useVintage";
import { supabase } from "@/integrations/ios-supabase/client";
import { fetchSavedChemicalsForVineyard } from "@/lib/savedChemicalsQuery";
import { toChemicalIntelligence, activityGroupSummary, VERIFICATION_LABEL } from "@/lib/chemicalIntelligence";
import { jurisdictionNotice } from "@/lib/chemicalJurisdiction";
import {
  RULESET_DRIFT_MESSAGE,
  newPositionId,
  normaliseGroupCodes,
  planValidationIssues,
  positionGroupLabel,
  type ResistancePlan,
  type ResistancePlanPosition,
} from "@/lib/resistancePlanContract";
import { createResistancePlan, saveResistancePlan } from "@/lib/resistancePlanQuery";
import { isRevisionConflict, RevisionConflictError } from "@/lib/revisionWrite";
import { useResistancePlanAssessment } from "@/hooks/useResistancePlanAssessment";
import { ResistanceEvaluationCard, STATUS_LABEL } from "./ResistanceEvaluationCard";
import { DISEASE_LABEL, type ResistanceDisease } from "@/lib/resistance/resistanceRuleset";
import { makeSeasonCalendar, seasonForEpochMs, seasonIdForStartYear } from "@/lib/resistance/resistanceSeason";
import { fmtDate } from "@/lib/dateFormat";

const DISEASES: ResistanceDisease[] = ["powdery_mildew", "downy_mildew"];

export function ResistancePlanEditor({
  initial,
  onClose,
}: {
  initial: ResistancePlan;
  onClose: () => void;
}) {
  const { selectedVineyardId } = useVineyard();
  const { seasonStartMonth, seasonStartDay } = useVintage();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [plan, setPlan] = useState<ResistancePlan>(initial);
  const [acknowledged, setAcknowledged] = useState(false);
  const [conflict, setConflict] = useState<RevisionConflictError | null>(null);

  const vineyardId = plan.vineyardId || selectedVineyardId || "";

  const blocksQ = useQuery({
    queryKey: ["resistance-planner-blocks", vineyardId],
    enabled: !!vineyardId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paddocks")
        .select("id, name, variety_allocations")
        .eq("vineyard_id", vineyardId)
        .is("deleted_at", null)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const blocks = blocksQ.data ?? [];

  const chemicalsQ = useQuery({
    queryKey: ["saved_chemicals", vineyardId, "active"],
    enabled: !!vineyardId,
    queryFn: () => fetchSavedChemicalsForVineyard(vineyardId),
  });

  const intelligence = useMemo(
    () => (chemicalsQ.data?.chemicals ?? []).map((c: any) => toChemicalIntelligence(c)),
    [chemicalsQ.data],
  );
  const intelligenceById = useMemo(
    () => new Map(intelligence.map((c) => [c.id, c])),
    [intelligence],
  );

  const seasonCalendar = useMemo(
    () => makeSeasonCalendar({ startMonth: seasonStartMonth, startDay: seasonStartDay }),
    [seasonStartMonth, seasonStartDay],
  );
  const seasonOptions = useMemo(() => {
    const current = seasonForEpochMs(seasonCalendar, Date.now());
    const years = [current.startYear + 1, current.startYear, current.startYear - 1, current.startYear - 2];
    const ids = years.map(seasonIdForStartYear);
    if (plan.seasonId && !ids.includes(plan.seasonId)) ids.push(plan.seasonId);
    return ids;
  }, [seasonCalendar, plan.seasonId]);

  const assessment = useResistancePlanAssessment({
    enabled: true,
    vineyardId,
    plan,
    blocks: blocks.map((b) => ({ id: b.id, name: b.name })),
    intelligenceById,
  });

  const issues = planValidationIssues({ ...plan, vineyardId });
  const needsAck = assessment.requiresAcknowledgement;
  const canSave = issues.length === 0 && (!needsAck || acknowledged);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payloadPlan: ResistancePlan = {
        ...plan,
        vineyardId,
        crop: plan.crop ?? "grape",
        jurisdiction: plan.jurisdiction ?? assessment.jurisdiction,
        // Provenance of the ruleset the plan was last evaluated against.
        rulesetId: assessment.currentRulesetId ?? plan.rulesetId,
        rulesetVersion: assessment.currentRulesetVersion ?? plan.rulesetVersion,
      };
      return plan.id ? saveResistancePlan(payloadPlan) : createResistancePlan(payloadPlan);
    },
    onSuccess: (saved) => {
      setPlan(saved);
      qc.invalidateQueries({ queryKey: ["resistance-plans", vineyardId] });
      toast({ title: "Resistance plan saved" });
    },
    onError: (err: unknown) => {
      if (isRevisionConflict(err)) {
        setConflict(err as RevisionConflictError);
        return;
      }
      toast({
        title: "Plan not saved",
        description: (err as Error)?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  /* ------------------------------------------------------------ positions */

  const patchPosition = (id: string, patch: Partial<ResistancePlanPosition>) =>
    setPlan((p) => ({
      ...p,
      positions: p.positions.map((pos) => (pos.id === id ? { ...pos, ...patch } : pos)),
    }));

  const addPosition = () =>
    setPlan((p) => ({
      ...p,
      positions: [
        ...p.positions,
        {
          id: newPositionId(),
          sequence: p.positions.length + 1,
          groups: [],
          savedChemicalId: null,
          productName: null,
          target: null,
          growthStage: null,
          notes: null,
          keyStyle: "camel" as const,
          extra: {},
        },
      ],
    }));

  const removePosition = (id: string) =>
    setPlan((p) => ({
      ...p,
      positions: p.positions
        .filter((pos) => pos.id !== id)
        .map((pos, i) => ({ ...pos, sequence: i + 1 })),
    }));

  const movePosition = (id: string, delta: number) =>
    setPlan((p) => {
      const list = [...p.positions].sort((a, b) => a.sequence - b.sequence);
      const idx = list.findIndex((pos) => pos.id === id);
      const target = idx + delta;
      if (idx < 0 || target < 0 || target >= list.length) return p;
      [list[idx], list[target]] = [list[target], list[idx]];
      return { ...p, positions: list.map((pos, i) => ({ ...pos, sequence: i + 1 })) };
    });

  const toggleBlock = (id: string) =>
    setPlan((p) => ({
      ...p,
      blockIds: p.blockIds.includes(id)
        ? p.blockIds.filter((b) => b !== id)
        : [...p.blockIds, id],
    }));

  /* ----------------------------------------------------------------- view */

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">
            {plan.id ? "Edit resistance plan" : "New resistance plan"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {plan.id ? `Plan ${plan.id.slice(0, 8)} · revision ${plan.serverRevision ?? "—"}` : "Not saved yet"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            <X className="mr-1 h-4 w-4" /> Close
          </Button>
          <Button disabled={!canSave || saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            Save plan
          </Button>
        </div>
      </div>

      {conflict && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
          <div className="font-medium">This plan was changed elsewhere</div>
          <p className="mt-1 text-xs">{conflict.message}</p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const latest = conflict.latest as ResistancePlan | null;
                if (latest) setPlan(latest);
                setConflict(null);
              }}
            >
              Reload the server version
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>
              Keep my edits
            </Button>
          </div>
        </div>
      )}

      {assessment.drift.drifted && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          {RULESET_DRIFT_MESSAGE} Saved against {assessment.drift.storedId} ·{" "}
          {assessment.drift.storedVersion}; current strategy is {assessment.drift.currentId} ·{" "}
          {assessment.drift.currentVersion}.
        </div>
      )}

      {!assessment.supported && (
        <div className="rounded-md border border-muted-foreground/30 bg-muted/40 p-3 text-sm">
          Resistance planning strategy not yet supported for this jurisdiction (
          {assessment.jurisdiction}). Australian CropLife rules are deliberately not applied as a
          fallback.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        {/* ------------------------------------------------ plan controls */}
        <div className="space-y-4">
          <section className="space-y-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Plan</h3>
            <div className="space-y-1">
              <Label className="text-xs">Season</Label>
              <Select
                value={plan.seasonId}
                onValueChange={(v) => setPlan((p) => ({ ...p, seasonId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a season" />
                </SelectTrigger>
                <SelectContent>
                  {seasonOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Disease</Label>
              <Select
                value={String(plan.disease)}
                onValueChange={(v) => setPlan((p) => ({ ...p, disease: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a disease" />
                </SelectTrigger>
                <SelectContent>
                  {DISEASES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {DISEASE_LABEL[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Only powdery and downy mildew strategies are published for VineTrack today.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Jurisdiction</Label>
              <Input value={assessment.jurisdiction} readOnly className="bg-muted/40" />
              <p className="text-[11px] text-muted-foreground">
                Taken from the vineyard. It cannot be switched on the plan.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea
                rows={3}
                value={plan.notes ?? ""}
                onChange={(e) => setPlan((p) => ({ ...p, notes: e.target.value || null }))}
              />
            </div>
          </section>

          <section className="space-y-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Blocks</h3>
            {blocksQ.isLoading && <p className="text-xs text-muted-foreground">Loading blocks…</p>}
            <div className="max-h-72 divide-y overflow-auto rounded-md border">
              {blocks.map((b) => {
                const varieties = Array.isArray(b.variety_allocations)
                  ? b.variety_allocations
                      .map((v: any) => v?.variety ?? v?.name)
                      .filter(Boolean)
                      .join(", ")
                  : null;
                return (
                  <label
                    key={b.id}
                    className="flex cursor-pointer items-center gap-2 px-2 py-2 text-sm hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={plan.blockIds.includes(b.id)}
                      onCheckedChange={() => toggleBlock(b.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {b.name ?? "Unnamed block"}
                      {varieties && (
                        <span className="ml-2 text-xs text-muted-foreground">{varieties}</span>
                      )}
                    </span>
                  </label>
                );
              })}
              {!blocksQ.isLoading && blocks.length === 0 && (
                <p className="p-2 text-xs text-muted-foreground">No blocks for this vineyard.</p>
              )}
            </div>
          </section>
        </div>

        {/* --------------------------------------- combined history/plan */}
        <div className="space-y-4">
          <section className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Actual applications this season</h3>
              <Badge variant="secondary">{assessment.actualEvents.length}</Badge>
            </div>
            {assessment.isLoading && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading spray records…
              </p>
            )}
            {assessment.historyUnavailable && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                Season spray history could not be read, so this plan cannot be fully assessed. An
                empty history query is not treated as a clean season.
              </div>
            )}
            {!assessment.isLoading && assessment.actualEvents.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No completed applications recorded for these blocks this season.
              </p>
            )}
            <div className="space-y-2">
              {assessment.actualEvents.map((e) => (
                <div
                  key={`${e.applicationId}|${e.blockId}`}
                  className="rounded-md border border-muted-foreground/30 bg-muted/20 px-3 py-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">Completed spray</Badge>
                    <span className="font-medium">{fmtDate(new Date(e.appliedAtEpochMs))}</span>
                    <span className="text-muted-foreground">
                      {blocks.find((b) => b.id === e.blockId)?.name ?? e.blockId}
                    </span>
                  </div>
                  <div className="mt-1">
                    {e.products.map((pl) => pl.productName ?? "Product not recorded").join(", ") ||
                      "No products recorded"}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.products.flatMap((pl) => pl.groups.codes).map((c, i) => (
                      <Badge key={`${c}-${i}`} variant="outline" className="text-[10px]">
                        Group {c}
                      </Badge>
                    ))}
                    {!e.targetsRecorded && (
                      <Badge variant="outline" className="text-[10px]">
                        Target not recorded
                      </Badge>
                    )}
                    {e.products.some((pl) => pl.availability !== "available_verified") && (
                      <Badge variant="outline" className="text-[10px]">
                        Chemistry uncertainty
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {assessment.unresolved.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                {assessment.unresolved.length} recorded spray
                {assessment.unresolved.length === 1 ? "" : "s"} this season have no recorded blocks,
                so they cannot be placed on any block's history. Results may be incomplete.
              </div>
            )}
          </section>

          <section className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Planned positions</h3>
              <Button size="sm" variant="outline" onClick={addPosition}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add position
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Positions are group-first: choose the resistance group (or a combination such as
              “3 + 11”). A product is optional.
            </p>

            {plan.positions.length === 0 && (
              <p className="text-xs text-muted-foreground">No planned positions yet.</p>
            )}

            <div className="space-y-2">
              {[...plan.positions]
                .sort((a, b) => a.sequence - b.sequence)
                .map((pos, index) => {
                  const intel = pos.savedChemicalId
                    ? intelligenceById.get(pos.savedChemicalId) ?? null
                    : null;
                  const notice = intel
                    ? jurisdictionNotice(intel.product.country, assessment.jurisdiction)
                    : null;
                  return (
                    <div
                      key={pos.id}
                      className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>Planned</Badge>
                        <span className="text-sm font-medium">Position {index + 1}</span>
                        <Badge variant="outline">{positionGroupLabel(pos)}</Badge>
                        <span className="ml-auto flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => movePosition(pos.id, -1)}
                            aria-label="Move up"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => movePosition(pos.id, 1)}
                            aria-label="Move down"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removePosition(pos.id)}
                            aria-label="Remove position"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </span>
                      </div>

                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Activity group(s)</Label>
                          <Input
                            defaultValue={pos.groups.join(" + ")}
                            placeholder="e.g. 3 or 3 + 11"
                            onBlur={(e) =>
                              patchPosition(pos.id, {
                                groups: normaliseGroupCodes(e.target.value.split(/[+,;/]/)),
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Product (optional)</Label>
                          <Select
                            value={pos.savedChemicalId ?? "none"}
                            onValueChange={(v) =>
                              patchPosition(pos.id, {
                                savedChemicalId: v === "none" ? null : v,
                                productName:
                                  v === "none"
                                    ? null
                                    : intelligenceById.get(v)?.name ?? null,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="No product" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No product</SelectItem>
                              {intelligence.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name ?? "Unnamed chemical"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Growth stage (optional)</Label>
                          <Input
                            defaultValue={pos.growthStage ?? ""}
                            onBlur={(e) =>
                              patchPosition(pos.id, { growthStage: e.target.value || null })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Notes (optional)</Label>
                          <Input
                            defaultValue={pos.notes ?? ""}
                            onBlur={(e) => patchPosition(pos.id, { notes: e.target.value || null })}
                          />
                        </div>
                      </div>

                      {intel && (
                        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                          <div>
                            {activityGroupSummary(intel) ?? "No activity group recorded"} ·{" "}
                            {VERIFICATION_LABEL[intel.verification.status]}
                          </div>
                          {intel.actives.length > 0 && (
                            <div>
                              {intel.actives
                                .map((a) =>
                                  [a.name, a.concentration && a.unit ? `${a.concentration} ${a.unit}` : null]
                                    .filter(Boolean)
                                    .join(" "),
                                )
                                .join(", ")}
                            </div>
                          )}
                          {notice?.message && (
                            <div className="text-amber-600">{notice.message}</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        </div>

        {/* -------------------------------------------------- assessment */}
        <div className="space-y-3">
          <section className="space-y-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Strategy assessment</h3>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">
                {assessment.overallStatus ? STATUS_LABEL[assessment.overallStatus] : "No result yet"}
              </Badge>
              {assessment.currentRulesetId && (
                <span className="text-muted-foreground">
                  {assessment.currentRulesetId} · {assessment.currentRulesetVersion}
                </span>
              )}
            </div>
            <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Recalculated from current spray records every time this plan opens. No verdict is
              stored on the plan.
            </p>

            {assessment.blocks.map((b) => (
              <div key={b.blockId} className="space-y-1">
                <h4 className="text-xs font-semibold">{b.blockName}</h4>
                <ResistanceEvaluationCard evaluation={b.evaluation} />
              </div>
            ))}
            {assessment.blocks.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Select blocks to see a per-block assessment.
              </p>
            )}
          </section>

          {needsAck && (
            <section className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
              <div className="flex items-start gap-2 text-sm font-medium">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                {assessment.overallStatus === "strategy_exceeded"
                  ? "This plan exceeds the published strategy"
                  : "This plan cannot be fully assessed"}
              </div>
              <label className="flex items-start gap-2 text-xs">
                <Checkbox
                  checked={acknowledged}
                  onCheckedChange={(v) => setAcknowledged(v === true)}
                />
                <span>
                  I have read the findings above and accept responsibility for saving this plan.
                </span>
              </label>
              <p className="text-[11px] text-muted-foreground">
                Acknowledgement is not stored — it applies to this save only.
              </p>
            </section>
          )}

          {issues.length > 0 && (
            <section className="rounded-md border p-3 text-xs">
              <div className="font-medium">Before saving</div>
              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
