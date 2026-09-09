// Add manual spray — full-page entry for COMPLETED work.
//
// No calculator, canopy, calibration, GPS or row-plan input is required. The
// quantities recorded here are exactly what the operator entered.
//
// The production save runs through Rork's shared completed-application
// contract. Until that function is deployed the Save action stays unavailable
// and the exact contract gaps are shown.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Plus, Trash2 } from "lucide-react";

import { PageHead } from "@/components/PageHead";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PortalNotice } from "@/components/ui/PortalNotice";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import { useTeamLookup } from "@/hooks/useTeamLookup";
import { fetchVineyardMembersWithCategory } from "@/lib/teamMembersQuery";
import { fetchSavedChemicalsForVineyard, type SavedChemical } from "@/lib/savedChemicalsQuery";
import { parsePhysicalForm, packUnitForForm, formFromInventoryUnit } from "@/lib/chemicalPhysicalForm";

import { ManualEntryBadge } from "@/components/spray/ManualEntryBadge";
import {
  addTank, copyPreviousTank, removeTank, chemicalTotals, costingHours,
  emptyManualSprayDraft, newChemicalLine, totalWaterLitres,
  type ManualChemicalLine, type ManualSprayDraft,
} from "@/lib/manualSpray/domain";
import { validateManualSpray } from "@/lib/manualSpray/validate";
import { parseAmountText, unitsForForm, UNIT_DISPLAY_LABEL, WIRE_UNITS, type WireUnit } from "@/lib/manualSpray/units";
import {
  MANUAL_SPRAY_UNAVAILABLE_MESSAGE, probeManualSprayContract, saveManualSpray,
  freezeManualSprayAttempt,
  type ManualSprayAttempt, type ManualSprayIdentities, type ManualSpraySaveOutcome,
} from "@/lib/manualSpray/contract";
import { loadManualSprayDraft } from "@/lib/manualSpray/load";
import { recoverSprayWeather } from "@/lib/sprayWeatherRecovery";
import { useCanEnterManualSpray, MANUAL_SPRAY_DENIED_MESSAGE } from "@/lib/manualSpray/permissions";

interface NamedRow { id: string; name: string | null }

/**
 * Save outcomes are kept apart. "Saved but the list didn't reload" is NEVER
 * reported as unsaved, and an uncertain response is never reported as failed.
 */
type SaveState =
  | null
  | { kind: "saved" }
  | { kind: "refresh-failed" }
  | Exclude<ManualSpraySaveOutcome, { kind: "saved" }>;

const fetchNamed = async (table: string, vineyardId: string): Promise<NamedRow[]> => {
  const { data, error } = await supabase
    .from(table as any)
    .select("id,name")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (error) throw error;
  return ((data ?? []) as NamedRow[]).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
};

export default function ManualSprayEntryPage() {
  const { selectedVineyardId } = useVineyard();
  const canEnter = useCanEnterManualSpray();
  const navigate = useNavigate();
  const { toast } = useToast();
  const vineyardId = selectedVineyardId ?? "";

  // Edit mode: /spray-records/manual/:sprayRecordId/edit. The saved
  // application is reloaded with ALL of its identities — never a fresh draft.
  const { sprayRecordId: editRecordId } = useParams<{ sprayRecordId: string }>();
  const isEdit = !!editRecordId;

  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ManualSprayDraft>(() => emptyManualSprayDraft(vineyardId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!editRecordId);

  useEffect(() => {
    if (!editRecordId) return;
    let cancelled = false;
    setLoaded(false);
    setLoadError(null);
    void loadManualSprayDraft(editRecordId).then((res) => {
      if (cancelled) return;
      if (res.draft) setDraft(res.draft);
      else setLoadError(res.error ?? "This manual spray could not be loaded.");
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [editRecordId]);

  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  /** The frozen, unresolved save attempt. Retry re-sends exactly this. */
  const [attempt, setAttempt] = useState<ManualSprayAttempt | null>(null);
  const [saved, setSaved] = useState<ManualSprayIdentities | null>(null);
  const [outcome, setOutcome] = useState<SaveState>(null);

  const patch = (p: Partial<ManualSprayDraft>) => setDraft((d) => ({ ...d, ...p, vineyardId }));

  /**
   * Any edit to the draft discards the frozen attempt: a later save is a new
   * operation at the latest version, never a re-send of a superseded request.
   */
  useEffect(() => {
    setAttempt(null);
    setOutcome((o) => (o?.kind === "saved" || o?.kind === "refresh-failed" ? o : null));
  }, [draft]);

  const tractorsQ = useQuery({ queryKey: ["ms-tractors", vineyardId], enabled: !!vineyardId, queryFn: () => fetchNamed("tractors", vineyardId) });
  const sprayQ = useQuery({ queryKey: ["ms-spray-equipment", vineyardId], enabled: !!vineyardId, queryFn: () => fetchNamed("spray_equipment", vineyardId) });
  const blocksQ = useQuery({ queryKey: ["ms-paddocks", vineyardId], enabled: !!vineyardId, queryFn: () => fetchNamed("paddocks", vineyardId) });
  const membersQ = useQuery({ queryKey: ["ms-members", vineyardId], enabled: !!vineyardId, queryFn: () => fetchVineyardMembersWithCategory(vineyardId) });
  const chemicalsQ = useQuery({
    queryKey: ["ms-chemicals", vineyardId], enabled: !!vineyardId,
    queryFn: async () => (await fetchSavedChemicalsForVineyard(vineyardId)).chemicals,
  });
  const contractQ = useQuery({ queryKey: ["ms-contract"], queryFn: probeManualSprayContract, staleTime: 60_000 });
  const { resolve } = useTeamLookup(vineyardId || null);

  const chemicals = chemicalsQ.data ?? [];
  const validation = useMemo(() => validateManualSpray({ ...draft, vineyardId }), [draft, vineyardId]);
  const totals = useMemo(() => chemicalTotals(draft.tanks), [draft.tanks]);
  const hours = useMemo(
    () => costingHours({
      startEngineHours: draft.startEngineHours, endEngineHours: draft.endEngineHours,
      startAt: draft.startAt, endAt: draft.endAt,
    }),
    [draft.startEngineHours, draft.endEngineHours, draft.startAt, draft.endAt],
  );

  const contractAvailable = contractQ.data?.available === true;
  const gaps = contractQ.data?.gaps ?? [];

  const errorFor = (test: (v: { field: string; tankId?: string; lineId?: string }) => boolean) =>
    showErrors ? validation.violations.find(test)?.message ?? null : null;

  function setTankWater(tankId: string, text: string) {
    const parsed = parseAmountText(text);
    setDraft((d) => ({
      ...d,
      tanks: d.tanks.map((t) => (t.id === tankId ? { ...t, waterLitres: parsed === undefined ? Number.NaN : parsed } : t)),
    }));
  }

  function updateLine(tankId: string, lineId: string, p: Partial<ManualChemicalLine>) {
    setDraft((d) => ({
      ...d,
      tanks: d.tanks.map((t) =>
        t.id === tankId
          ? { ...t, chemicals: t.chemicals.map((c) => (c.id === lineId ? { ...c, ...p } : c)) }
          : t,
      ),
    }));
  }

  /** Selecting a store product brings identity, name, category, form and unit. */
  function pickChemical(tankId: string, lineId: string, chem: SavedChemical) {
    const form = (() => {
      const explicit = parsePhysicalForm((chem as any).form_type ?? (chem as any).physical_form);
      return explicit !== "unknown" ? explicit : formFromInventoryUnit(chem.unit);
    })();
    const pack = packUnitForForm(form);
    updateLine(tankId, lineId, {
      savedChemicalId: chem.id,
      productName: chem.name ?? "",
      category: chem.product_category ?? null,
      physicalForm: form,
      unit: (pack ?? null) as WireUnit | null,
      // The amount is always the operator's entry — never a store default rate.
      amount: null,
      snapshot: {
        name: chem.name ?? null,
        product_category: chem.product_category ?? null,
        manufacturer: chem.manufacturer ?? null,
        registration_number: chem.registration_number ?? null,
        active_ingredient: chem.active_ingredient ?? null,
      },
      snapshotAt: new Date().toISOString(),
    });
  }

  /**
   * One logical save. The attempt — operation id, expected version and the
   * whole payload including every identity and snapshot time — is frozen the
   * first time and re-sent unchanged by Retry. Editing the draft afterwards
   * discards it, so the next save is a new operation at the latest version.
   */
  async function runSave(existing?: ManualSprayAttempt) {
    setShowErrors(true);
    if (!validation.ok) {
      setOutcome({ kind: "refused", message: validation.violations[0]?.message ?? "Check the highlighted fields." });
      toast({ title: "Check the highlighted fields", description: validation.violations[0]?.message, variant: "destructive" });
      return;
    }
    const frozen = existing ?? freezeManualSprayAttempt({ ...draft, vineyardId });
    setAttempt(frozen);
    setSaving(true);
    const out = await saveManualSpray(frozen);
    setSaving(false);

    if (out.kind !== "saved") {
      setOutcome(out);
      return;
    }
    // Confirmed by the server. The attempt is resolved and must not be re-sent.
    setAttempt(null);
    setSaved(out.identities);
    setDraft((d) => ({ ...d, ...out.identities }));
    const refreshed = await refreshAfterSave(out.identities.tripId);
    setOutcome(refreshed ? { kind: "saved" } : { kind: "refresh-failed" });
    // Weather recovery is a courtesy after the fact: it can never block or
    // undo a save, and manually entered conditions are always kept.
    void recoverSprayWeather(out.identities.tripId, draft.endAt ?? new Date().toISOString());
  }

  async function refreshAfterSave(tripId: string): Promise<boolean> {
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["spray-records"] }),
        queryClient.invalidateQueries({ queryKey: ["spray-report", tripId] }),
        queryClient.invalidateQueries({ queryKey: ["trips"] }),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  if (!canEnter) {
    return (
      <div className="space-y-4">
        <PageHead path="/spray-records/manual/new" title="Add manual spray" description="Record a completed spray application." />
        <PortalNotice variant="warning" description={MANUAL_SPRAY_DENIED_MESSAGE} />
      </div>
    );
  }

  if (isEdit && !loaded) {
    return (
      <div className="space-y-4">
        <PageHead path="/spray-records" title="Edit manual spray" description="Edit a completed manual spray application." />
        <p className="text-sm text-muted-foreground">Loading this manual spray…</p>
      </div>
    );
  }

  if (isEdit && loadError) {
    return (
      <div className="space-y-4">
        <PageHead path="/spray-records" title="Edit manual spray" description="Edit a completed manual spray application." />
        <PortalNotice variant="warning" title="This manual spray couldn't be opened" description={loadError} />
        <Button variant="outline" onClick={() => navigate("/spray-records")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to spray records
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-16">
      <PageHead
        path={isEdit ? "/spray-records" : "/spray-records/manual/new"}
        title={`${isEdit ? "Edit" : "Add"} manual spray | VineTrack`}
        description="Record a completed spray application with actual water and chemical amounts."
      />

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{isEdit ? "Edit manual spray" : "Add manual spray"}</h1>
            <ManualEntryBadge />
          </div>
          <p className="text-sm text-muted-foreground">
            Record work that has already been done. No calculator, canopy or GPS route is needed.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/spray-records")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to spray records
        </Button>
      </div>

      {!contractAvailable && (
        <PortalNotice
          variant="warning"
          title="Saving is waiting on the shared backend"
          description={`${MANUAL_SPRAY_UNAVAILABLE_MESSAGE}${gaps.length ? ` Outstanding: ${gaps.join(" ")}` : ""}`}
        />
      )}

      {/* ---------------------------------------------- Application details */}
      <Card className="p-4 space-y-3">
        <h2 className="font-medium">Application details</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name / reference" error={errorFor((v) => v.field === "name")}>
            <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Block 3 fungicide" />
          </Field>
          <Field label="Start (date & time)" error={errorFor((v) => v.field === "startAt")}>
            <Input type="datetime-local" value={toLocalInput(draft.startAt)} onChange={(e) => patch({ startAt: fromLocalInput(e.target.value) })} />
          </Field>
          <Field label="End (date & time)" error={errorFor((v) => v.field === "endAt")}>
            <Input type="datetime-local" value={toLocalInput(draft.endAt)} onChange={(e) => patch({ endAt: fromLocalInput(e.target.value) })} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">Times are in the vineyard's local time. Work may cross midnight.</p>
      </Card>

      {/* ------------------------------------------- Operator and equipment */}
      <Card className="p-4 space-y-3">
        <h2 className="font-medium">Operator and equipment</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Operator" error={errorFor((v) => v.field === "operator")}>
            <Picker
              value={draft.operatorUserId}
              onChange={(v) => patch({ operatorUserId: v })}
              placeholder="Select the operator"
              options={(membersQ.data ?? []).map((m) => ({ id: m.user_id, label: resolve(m.user_id) ?? "Member" }))}
            />
          </Field>
          <Field label="Tractor" error={errorFor((v) => v.field === "tractor")}>
            <Picker
              value={draft.tractorId}
              onChange={(v) => patch({ tractorId: v })}
              placeholder="Select the tractor"
              options={(tractorsQ.data ?? []).map((t) => ({ id: t.id, label: t.name ?? "Tractor" }))}
            />
          </Field>
          <Field label="Spray unit" error={errorFor((v) => v.field === "sprayUnit")}>
            <Picker
              value={draft.sprayEquipmentId}
              onChange={(v) => patch({ sprayEquipmentId: v })}
              placeholder="Select the spray unit"
              options={(sprayQ.data ?? []).map((s) => ({ id: s.id, label: s.name ?? "Spray unit" }))}
            />
          </Field>
          <Field label="Start engine hours (optional)" error={errorFor((v) => v.field === "engineHours")}>
            <Input inputMode="decimal" value={draft.startEngineHours ?? ""} onChange={(e) => patch({ startEngineHours: numOrNull(e.target.value) })} />
          </Field>
          <Field label="End engine hours (optional)">
            <Input inputMode="decimal" value={draft.endEngineHours ?? ""} onChange={(e) => patch({ endEngineHours: numOrNull(e.target.value) })} />
          </Field>
          <div className="text-xs text-muted-foreground self-end pb-2">
            Hours used for costing: {hours.hours == null ? "—" : `${hours.hours} h`} ({hours.basis === "engine_hours" ? "engine hours" : "recorded work time"})
          </div>
        </div>
      </Card>

      {/* --------------------------------------------------------- Blocks */}
      <Card className="p-4 space-y-3">
        <h2 className="font-medium">Blocks sprayed</h2>
        {errorFor((v) => v.field === "blocks") && <p className="text-xs text-destructive">{errorFor((v) => v.field === "blocks")}</p>}
        <div className="grid gap-2 sm:grid-cols-3">
          {(blocksQ.data ?? []).map((b) => (
            <label key={b.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft.blockIds.includes(b.id)}
                onCheckedChange={(c) =>
                  patch({
                    blockIds: c ? [...draft.blockIds, b.id] : draft.blockIds.filter((x) => x !== b.id),
                    // The recorded name travels with the id.
                    blockNames: { ...(draft.blockNames ?? {}), [b.id]: b.name ?? "" },
                  })
                }
              />
              {b.name ?? "Block"}
            </label>
          ))}
          {(blocksQ.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No blocks found for this vineyard.</p>}
        </div>
      </Card>

      {/* ------------------------------------------------ Tanks & chemicals */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-medium">Tanks and chemicals ({draft.tanks.length})</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setDraft((d) => ({ ...d, tanks: copyPreviousTank(d.tanks) }))}>
              <Copy className="h-4 w-4 mr-1" /> Copy previous tank
            </Button>
            <Button size="sm" onClick={() => setDraft((d) => ({ ...d, tanks: addTank(d.tanks) }))}>
              <Plus className="h-4 w-4 mr-1" /> Add tank
            </Button>
          </div>
        </div>

        {draft.tanks.map((tank) => (
          <div key={tank.id} className="rounded-md border p-3 space-y-3">
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <Field label={`Tank ${tank.displayNumber} — water used (L)`} error={errorFor((v) => v.field === "water" && v.tankId === tank.id)}>
                <Input
                  inputMode="decimal"
                  className="w-40"
                  value={tank.waterLitres == null || Number.isNaN(tank.waterLitres) ? "" : tank.waterLitres}
                  onChange={(e) => setTankWater(tank.id, e.target.value)}
                />
              </Field>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    tanks: d.tanks.map((t) => (t.id === tank.id ? { ...t, chemicals: [...t.chemicals, newChemicalLine()] } : t)),
                  }))
                }>
                  <Plus className="h-4 w-4 mr-1" /> Add chemical
                </Button>
                {draft.tanks.length > 1 && (
                  <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, tanks: removeTank(d.tanks, tank.id) }))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {errorFor((v) => v.field === "chemical" && v.tankId === tank.id && !v.lineId) && (
              <p className="text-xs text-destructive">{errorFor((v) => v.field === "chemical" && v.tankId === tank.id && !v.lineId)}</p>
            )}

            {tank.chemicals.map((line) => {
              const allowed = unitsForForm(line.physicalForm);
              return (
                <div key={line.id} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] items-end">
                  <Field label="Product">
                    <Picker
                      value={line.savedChemicalId}
                      onChange={(id) => {
                        const chem = chemicals.find((c) => c.id === id);
                        if (chem) pickChemical(tank.id, line.id, chem);
                      }}
                      placeholder="Choose from the Chemical Store"
                      options={chemicals.map((c) => ({ id: c.id, label: c.name ?? "Product" }))}
                    />
                  </Field>
                  <Field label="Amount used">
                    <Input
                      inputMode="decimal"
                      value={line.amount == null || Number.isNaN(line.amount) ? "" : line.amount}
                      onChange={(e) => {
                        const parsed = parseAmountText(e.target.value);
                        updateLine(tank.id, line.id, { amount: parsed === undefined ? Number.NaN : parsed });
                      }}
                    />
                  </Field>
                  <Field label="Unit">
                    <Select value={line.unit ?? ""} onValueChange={(u) => updateLine(tank.id, line.id, { unit: u as WireUnit })}>
                      <SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger>
                      <SelectContent>
                        {(allowed.length ? allowed : [...WIRE_UNITS]).map((u) => (
                          <SelectItem key={u} value={u}>{UNIT_DISPLAY_LABEL[u]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Button size="sm" variant="ghost" onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      tanks: d.tanks.map((t) => (t.id === tank.id ? { ...t, chemicals: t.chemicals.filter((c) => c.id !== line.id) } : t)),
                    }))
                  }>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <div className="sm:col-span-4 -mt-1 text-xs text-muted-foreground">
                    {line.productName ? `${line.productName}${line.category ? ` · ${line.category}` : ""} · ${line.physicalForm}` : "No product selected"}
                    {errorFor((v) => v.lineId === line.id) && (
                      <span className="text-destructive"> — {errorFor((v) => v.lineId === line.id)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </Card>

      {/* -------------------------------------------------------- Weather */}
      <Card className="p-4 space-y-2">
        <h2 className="font-medium">Weather</h2>
        <p className="text-sm text-muted-foreground">
          Enter the conditions you recorded. Anything you type here is always kept and labelled as manually entered.
          After saving, we also ask the weather station for the hours it holds for this period — that never changes
          what you entered, and it can't stop the spray being saved.
        </p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Temperature (°C)"><Input inputMode="decimal" value={draft.weather[0]?.temperature ?? ""} onChange={(e) => setWeather(setDraft, { temperature: numOrNull(e.target.value) })} /></Field>
          <Field label="Humidity (%)"><Input inputMode="decimal" value={draft.weather[0]?.humidity ?? ""} onChange={(e) => setWeather(setDraft, { humidity: numOrNull(e.target.value) })} /></Field>
          <Field label="Wind speed"><Input inputMode="decimal" value={draft.weather[0]?.windSpeed ?? ""} onChange={(e) => setWeather(setDraft, { windSpeed: numOrNull(e.target.value) })} /></Field>
          <Field label="Wind direction"><Input value={draft.weather[0]?.windDirection ?? ""} onChange={(e) => setWeather(setDraft, { windDirection: e.target.value || null })} /></Field>
        </div>
      </Card>

      {/* ------------------------------------------------- Review and save */}
      <Card className="p-4 space-y-3">
        <h2 className="font-medium">Review</h2>
        <div className="grid gap-2 sm:grid-cols-3 text-sm">
          <Summary label="Tanks" value={String(draft.tanks.length)} />
          <Summary label="Total water" value={`${totalWaterLitres(draft.tanks)} L`} />
          <Summary label="Blocks" value={String(draft.blockIds.length)} />
        </div>
        <div className="text-sm">
          <div className="text-xs text-muted-foreground mb-1">Chemical totals (manually recorded actual use)</div>
          {totals.length === 0 ? <p className="text-muted-foreground">No chemical amounts entered yet.</p> : (
            <ul className="space-y-0.5">
              {totals.map((t) => (
                <li key={t.key}>{t.productName}: {t.base} {t.baseUnit}</li>
              ))}
            </ul>
          )}
        </div>
        <Field label="Notes (optional)">
          <Textarea rows={2} value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </Field>
        {outcome?.kind === "saved" && (
          <PortalNotice variant="success" title="Manual spray saved" description="It's recorded as a manual entry and appears in your spray records." />
        )}
        {outcome?.kind === "refresh-failed" && (
          <PortalNotice
            variant="warning"
            title="Saved — but the list didn't reload"
            description="Your spray was saved. Only the on-screen refresh failed, so nothing needs saving again."
          />
        )}
        {outcome?.kind === "uncertain" && (
          <PortalNotice variant="warning" title="We didn't get an answer from the server" description={outcome.message} />
        )}
        {outcome?.kind === "conflict" && (
          <PortalNotice variant="warning" title="Changed somewhere else" description={outcome.message} />
        )}
        {outcome?.kind === "deleted" && (
          <PortalNotice variant="warning" title="This spray was deleted" description={outcome.message} />
        )}
        {(outcome?.kind === "refused" || outcome?.kind === "denied" || outcome?.kind === "unavailable") && (
          <PortalNotice variant="warning" title="Not saved" description={outcome.message} />
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {!saved && (
            <Button onClick={() => runSave()} disabled={saving || !contractAvailable}>
              {saving ? "Saving…" : "Save manual spray"}
            </Button>
          )}
          {attempt && !saved && outcome?.kind !== "deleted" && (
            <Button variant="outline" disabled={saving} onClick={() => runSave(attempt)}>
              Retry (sends the same entry)
            </Button>
          )}
          {saved && outcome?.kind === "refresh-failed" && (
            <Button
              variant="outline"
              onClick={async () => setOutcome((await refreshAfterSave(saved.tripId)) ? { kind: "saved" } : { kind: "refresh-failed" })}
            >
              Retry refresh
            </Button>
          )}
          {saved && (
            <Button onClick={() => navigate(`/spray-records?trip=${saved.tripId}`)}>View spray record</Button>
          )}
          <Button variant="outline" onClick={() => navigate("/spray-records")}>
            {saved ? "Done" : "Cancel"}
          </Button>
          {!contractAvailable && <span className="text-xs text-muted-foreground">{MANUAL_SPRAY_UNAVAILABLE_MESSAGE}</span>}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- helpers */

function setWeather(
  setDraft: React.Dispatch<React.SetStateAction<ManualSprayDraft>>,
  p: Partial<ManualSprayDraft["weather"][number]>,
) {
  setDraft((d) => {
    const first = d.weather[0] ?? { provenance: "manual" as const };
    return { ...d, weather: [{ ...first, ...p, provenance: "manual" }, ...d.weather.slice(1)] };
  });
}

const numOrNull = (t: string): number | null => {
  const v = t.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function Field({ label, error, children }: { label: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card/50 p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function Picker({
  value, onChange, options, placeholder,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  options: { id: string; label: string }[];
  placeholder: string;
}) {
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v || null)}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
