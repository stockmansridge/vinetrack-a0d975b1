// Unified Add Pin / Action (SQL 170) — the same creation workflow as iOS/Android.
// Step 1 location → Step 2 pin type → Step 3 button → Save.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { parsePolygonPoints, type LatLng } from "@/lib/paddockGeometry";
import ManualIssuesAppleMap from "@/components/manual-issues/ManualIssuesAppleMap";
import {
  buildSegments,
  manualIssueErrorMessage,
  parseRowSelection,
  ROW_SEGMENTS,
  summariseSegments,
} from "@/lib/manualIssues";
import GrowthStagePickerDialog from "@/components/pins/GrowthStagePickerDialog";
import { GROWTH_STAGE_LABEL } from "@/lib/vspWaterRate";
import {
  applyPinScopeChange,
  dedupePinButtons,
  isGrowthStageButton,
  emptyUnifiedPinForm,
  PIN_TYPE_LABELS,
  polygonCentroid,
  SCOPE_LABELS,
  UNIFIED_PIN_SCOPES,
  UNIFIED_PIN_TYPES,
  validateUnifiedPin,
  type PinButtonDef,
  type UnifiedPinForm,
  type UnifiedPinType,
} from "@/lib/unifiedPin";
import {
  useCreateCustomPinType,
  useCreateUnifiedPin,
  useCustomPinTypes,
  usePinButtonCatalogue,
} from "@/lib/unifiedPinQuery";

export interface PaddockOption {
  id: string;
  name: string | null;
  polygon_points?: any;
}

const FALLBACK_COLOUR = "#8E8E93";

export default function UnifiedPinDialog({
  open,
  onOpenChange,
  vineyardId,
  paddocks,
  defaultCentre,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vineyardId: string | null;
  paddocks: PaddockOption[];
  defaultCentre?: [number, number] | null;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<UnifiedPinForm>(emptyUnifiedPinForm());
  const [newCustomName, setNewCustomName] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  // Growth Stage uses the existing stage picker before the pin is written.
  const [stagePickerOpen, setStagePickerOpen] = useState(false);
  const [growthStageCode, setGrowthStageCode] = useState<string | null>(null);

  const buttons = usePinButtonCatalogue(vineyardId);
  const customTypes = useCustomPinTypes(vineyardId);
  const createType = useCreateCustomPinType(vineyardId);
  const createPin = useCreateUnifiedPin(vineyardId);

  useEffect(() => {
    if (!open) return;
    setForm(emptyUnifiedPinForm());
    setNewCustomName("");
    setAddingCustom(false);
    setStagePickerOpen(false);
    setGrowthStageCode(null);
  }, [open]);

  const set = (patch: Partial<UnifiedPinForm>) => setForm((f) => ({ ...f, ...patch }));

  const polygons = useMemo(
    () =>
      paddocks
        .map((p) => ({ id: p.id, pts: parsePolygonPoints(p.polygon_points) }))
        .filter((p): p is { id: string; pts: LatLng[] } => p.pts.length >= 3),
    [paddocks],
  );

  const mapPolygons = useMemo(
    () =>
      polygons.length || !defaultCentre
        ? polygons
        : [{ id: "centre", pts: [{ lat: defaultCentre[0], lng: defaultCentre[1] }] as LatLng[] }],
    [polygons, defaultCentre],
  );

  const centre = useMemo(() => {
    if (!form.paddockId) return defaultCentre ? { lat: defaultCentre[0], lng: defaultCentre[1] } : null;
    const poly = polygons.find((p) => p.id === form.paddockId);
    return polygonCentroid(poly?.pts ?? null);
  }, [form.paddockId, polygons, defaultCentre]);

  // Left/right catalogue variants collapse to one selectable button — the
  // unified workflow never stores a side.
  const buttonList: PinButtonDef[] = useMemo(() => {
    const raw =
      form.pinType === "repair"
        ? buttons.data?.repair ?? []
        : form.pinType === "growth"
          ? buttons.data?.growth ?? []
          : [];
    return dedupePinButtons(raw);
  }, [form.pinType, buttons.data]);

  const selectedButton = buttonList.find((b) => b.id === form.buttonId) ?? null;
  const selectedType = (customTypes.data ?? []).find((t) => t.id === form.customTypeId) ?? null;

  const rows = parseRowSelection(form.rowSelection);
  const segmentPreview = summariseSegments(buildSegments(rows, form.rowSections));

  const chooseType = (t: UnifiedPinType) => {
    setGrowthStageCode(null);
    setForm((f) => ({ ...f, pinType: t, buttonId: null, customTypeId: null }));
  };

  const chooseButton = (b: PinButtonDef) => {
    set({ buttonId: b.id });
    if (isGrowthStageButton(b)) {
      setGrowthStageCode(null);
      setStagePickerOpen(true);
    } else {
      setGrowthStageCode(null);
    }
  };

  const addCustomType = async () => {
    const name = newCustomName.trim();
    if (!name) return;
    try {
      const id = await createType.mutateAsync({ name });
      set({ customTypeId: id });
      setNewCustomName("");
      setAddingCustom(false);
      toast({ title: "Custom item added" });
    } catch (e) {
      toast({ title: manualIssueErrorMessage(e), variant: "destructive" });
    }
  };

  const submit = async () => {
    const problem = validateUnifiedPin(form);
    if (problem) {
      toast({ title: problem, variant: "destructive" });
      return;
    }
    if (isGrowthStageButton(selectedButton) && !growthStageCode) {
      setStagePickerOpen(true);
      return;
    }
    try {
      await createPin.mutateAsync({
        form,
        button: selectedButton,
        customTypeName: selectedType?.name ?? null,
        centre,
        growthStageCode,
      });
      toast({ title: "Pin added" });
      onOpenChange(false);
    } catch (e) {
      toast({ title: manualIssueErrorMessage(e), variant: "destructive" });
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manual Pin / Repair / Observation</DialogTitle>
          <DialogDescription>
            Drop a pin, select a row or select a block. Pins are shared with the VineTrack mobile apps.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          {/* Step 1 — location */}
          <section className="grid gap-3">
            <Label>1. Location</Label>
            <div className="grid gap-2">
              {UNIFIED_PIN_SCOPES.map((s) => {
                const active = form.scope === s;
                const Icon = SCOPE_ICONS[s];
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    data-testid={`pin-scope-${s}`}
                    onClick={() => setForm((f) => applyPinScopeChange(f, s))}
                    style={{
                      minHeight: LOCATION_CARD_MIN_HEIGHT,
                      borderColor: active ? PIN_BURGUNDY : undefined,
                    }}
                    className={`flex w-full items-center gap-4 rounded-lg border-2 px-4 py-4 text-left transition-colors ${
                      active ? "bg-accent" : "hover:bg-muted"
                    }`}
                  >
                    <span
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted"
                      style={active ? { background: PIN_BURGUNDY, color: "#fff" } : undefined}
                    >
                      <Icon className="h-6 w-6" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold">{SCOPE_LABELS[s]}</span>
                      <span className="block text-sm text-muted-foreground">{SCOPE_DESCRIPTIONS[s]}</span>
                    </span>
                    {active && <Check className="h-5 w-5 shrink-0" style={{ color: PIN_BURGUNDY }} />}
                  </button>
                );
              })}
            </div>

            {form.scope === "block" && (
              <div className="grid gap-2">
                <Label htmlFor="up-block">Block</Label>
                <Select
                  value={form.paddockId ?? "none"}
                  onValueChange={(v) => set({ paddockId: v === "none" ? null : v })}
                >
                  <SelectTrigger id="up-block"><SelectValue placeholder="Choose a block" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Choose a block</SelectItem>
                    {paddocks.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name ?? "Unnamed block"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}


            {form.scope === "point" && (
              <div className="space-y-2">
                <div className="h-[280px] w-full overflow-hidden rounded-md border">
                  <ManualIssuesAppleMap
                    markers={
                      form.latitude != null && form.longitude != null
                        ? [
                            {
                              id: "picked",
                              lat: form.latitude,
                              lng: form.longitude,
                              colour: selectedButton?.colour ?? selectedType?.colour ?? FALLBACK_COLOUR,
                            },
                          ]
                        : []
                    }
                    polygons={mapPolygons}
                    onPick={(lat, lng) => set({ latitude: lat, longitude: lng })}
                    fitKey="new-unified-pin"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {form.latitude != null && form.longitude != null
                    ? `Pinned at ${form.latitude.toFixed(5)}, ${form.longitude.toFixed(5)} — click the map to move it.`
                    : "Click the map to drop the pin."}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="up-block-opt">Block (optional)</Label>
                    <Select
                      value={form.paddockId ?? "none"}
                      onValueChange={(v) => set({ paddockId: v === "none" ? null : v })}
                    >
                      <SelectTrigger id="up-block-opt"><SelectValue placeholder="No block" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No block</SelectItem>
                        {paddocks.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name ?? "Unnamed block"}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="up-row">Row number (optional)</Label>
                    <Input
                      id="up-row"
                      inputMode="decimal"
                      value={form.drivingRowNumber ?? ""}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        set({
                          drivingRowNumber:
                            e.target.value === "" || !Number.isFinite(n) ? null : n,
                        });
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {form.scope === "row" && (
              <div className="space-y-3">
                <Label>Rows</Label>
                {rowGroups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No mapped rows are available for this vineyard yet.
                  </p>
                ) : (
                  <div className="max-h-64 space-y-3 overflow-y-auto rounded-md border p-3">
                    {rowGroups.map((g) => (
                      <div key={g.paddockId} className="space-y-1.5">
                        <p className="text-xs font-semibold text-muted-foreground">{g.blockName}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {g.rows.map((n) => {
                            const active = form.paddockId === g.paddockId && selectedRows.includes(n);
                            return (
                              <button
                                key={n}
                                type="button"
                                aria-label={`${g.blockName} row ${n}`}
                                aria-pressed={active}
                                onClick={() => setForm((f) => toggleRowInBlock(f, g.paddockId, n))}
                                style={active ? { borderColor: PIN_BURGUNDY, color: PIN_BURGUNDY } : undefined}
                                className={`rounded border px-2 py-1 text-xs tabular-nums ${
                                  active ? "bg-accent font-semibold" : "hover:bg-muted"
                                }`}
                              >
                                Row {n}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Row sections</Label>
                  <div className="flex flex-wrap gap-4">
                    {ROW_SEGMENTS.map((s) => (
                      <label key={s} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={form.rowSections.includes(s)}
                          onCheckedChange={(c) =>
                            set({
                              rowSections: c
                                ? [...form.rowSections, s].sort((a, b) => a - b)
                                : form.rowSections.filter((x) => x !== s),
                            })
                          }
                        />
                        Section {s}
                      </label>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedRows.length && !form.paddockId
                    ? ROW_BLOCK_MATCH_ERROR
                    : segmentPreview ?? "Select at least one row."}
                </p>
              </div>
            )}


            {form.scope === "block" && (
              <p className="text-sm text-muted-foreground">
                This pin applies to the whole selected block.
              </p>
            )}
          </section>

          {/* Step 2 — pin type */}
          <section className="grid gap-3">
            <Label>2. Pin type</Label>
            <div className="inline-flex w-fit rounded-md border bg-background p-0.5">
              {UNIFIED_PIN_TYPES.map((t) => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={form.pinType === t ? "secondary" : "ghost"}
                  className="h-7 px-3 text-xs"
                  onClick={() => chooseType(t)}
                >
                  {PIN_TYPE_LABELS[t]}
                </Button>
              ))}
            </div>
          </section>

          {/* Step 3 — button selection */}
          <section className="grid gap-3">
            <Label>3. {form.pinType === "custom" ? "Custom item" : `${PIN_TYPE_LABELS[form.pinType]} button`}</Label>

            {form.pinType !== "custom" && (
              <>
                {buttons.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading buttons…</p>
                ) : buttonList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No {PIN_TYPE_LABELS[form.pinType].toLowerCase()} buttons are configured for this vineyard yet.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {buttonList.map((b) => (
                      <Button
                        key={b.id}
                        type="button"
                        size="sm"
                        variant={form.buttonId === b.id ? "secondary" : "outline"}
                        className="h-8 gap-2"
                        onClick={() => chooseButton(b)}
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ background: b.colour ?? FALLBACK_COLOUR }}
                        />
                        {b.name}
                      </Button>
                    ))}
                  </div>
                )}
                {isGrowthStageButton(selectedButton) && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">
                      {growthStageCode
                        ? `Stage ${GROWTH_STAGE_LABEL.get(growthStageCode) ?? growthStageCode}`
                        : "No growth stage selected yet."}
                    </span>
                    <Button type="button" size="sm" variant="outline" onClick={() => setStagePickerOpen(true)}>
                      {growthStageCode ? "Change stage" : "Select growth stage"}
                    </Button>
                  </div>
                )}
              </>
            )}

            {form.pinType === "custom" && (
              <div className="space-y-3">
                {customTypes.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading custom items…</p>
                ) : (customTypes.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No custom items yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(customTypes.data ?? []).map((t) => (
                      <Button
                        key={t.id}
                        type="button"
                        size="sm"
                        variant={form.customTypeId === t.id ? "secondary" : "outline"}
                        className="h-8 gap-2"
                        onClick={() => set({ customTypeId: t.id })}
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ background: t.colour ?? FALLBACK_COLOUR }}
                        />
                        {t.name}
                      </Button>
                    ))}
                  </div>
                )}

                {addingCustom ? (
                  <div className="flex items-end gap-2">
                    <div className="grid flex-1 gap-2">
                      <Label htmlFor="up-custom">New custom item</Label>
                      <Input
                        id="up-custom"
                        value={newCustomName}
                        maxLength={60}
                        placeholder="e.g. Fence gate"
                        onChange={(e) => setNewCustomName(e.target.value)}
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={addCustomType}
                      disabled={createType.isPending || !newCustomName.trim()}
                    >
                      {createType.isPending ? "Adding…" : "Add"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setAddingCustom(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={() => setAddingCustom(true)}>
                    Add custom item
                  </Button>
                )}
              </div>
            )}
          </section>

          <div className="grid gap-2">
            <Label htmlFor="up-notes">Notes (optional)</Label>
            <Textarea
              id="up-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={createPin.isPending}>
            {createPin.isPending ? "Saving…" : "Save pin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      <GrowthStagePickerDialog
        open={stagePickerOpen}
        onOpenChange={setStagePickerOpen}
        value={growthStageCode}
        onSelect={(code) => {
          setGrowthStageCode(code);
          setStagePickerOpen(false);
        }}
      />
    </>
  );
}
