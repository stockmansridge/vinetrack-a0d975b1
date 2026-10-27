// Master bunch weights: one vineyard-wide value per variety plus optional
// block-specific overrides where that variety is planted. Reads the live
// yield_bunch_weights table; writes only via the upsert / soft-delete RPCs.
// No value is prefilled — an unset weight stays "Not configured".
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import {
  BUNCH_WEIGHT_SOURCE_LABEL,
  YIELD_BUNCH_WEIGHTS_KEY,
  canEditBunchWeights,
  resolveBunchWeight,
  softDeleteYieldBunchWeight,
  upsertYieldBunchWeight,
  type BlockVarietyIdentity,
  type BunchWeightSource,
  type YieldBunchWeightRow,
} from "@/lib/yieldBunchWeights";

export interface BunchWeightVariety {
  key: string;
  name: string;
  blocks: { id: string; name: string }[];
  /** No stored varietyKey on any planting — key derived from the name. */
  legacyKey: boolean;
}

export type BunchWeightBlock = { id: string; name: string; plantings: BlockVarietyIdentity[] };

/** Vineyard varieties grouped by stored canonical varietyKey, with the blocks they are planted in. */
export function bunchWeightVarieties(blocks: BunchWeightBlock[]): BunchWeightVariety[] {
  const map = new Map<string, BunchWeightVariety>();
  for (const b of blocks) {
    for (const p of b.plantings) {
      const key = p.key;
      const row = map.get(key) ?? { key, name: p.name, blocks: [], legacyKey: p.legacyKey };
      if (!p.legacyKey) row.legacyKey = false;
      if (!row.blocks.some((x) => x.id === b.id)) row.blocks.push({ id: b.id, name: b.name });
      map.set(key, row);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

const SOURCE_BADGE: Record<BunchWeightSource, string> = {
  block_override: "border-primary/40 bg-primary/10 text-primary",
  variety_default: "border-border bg-secondary text-secondary-foreground",
  not_configured: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function SourceBadge({ source }: { source: BunchWeightSource }) {
  return (
    <Badge variant="outline" className={`text-[10px] ${SOURCE_BADGE[source]}`}>
      {BUNCH_WEIGHT_SOURCE_LABEL[source]}
    </Badge>
  );
}

const fmtG = (g: number | null) =>
  g == null ? "—" : `${g.toLocaleString(undefined, { maximumFractionDigits: 1 })} g`;

function WeightEditor({
  label,
  disabled,
  onSave,
  saving,
}: {
  label: string;
  disabled: boolean;
  onSave: (grams: number) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState("");
  const n = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(n) && n > 0;
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.1"
        placeholder="g"
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={disabled}
        className="h-8 w-24"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        disabled={disabled || !valid || saving}
        onClick={() => {
          onSave(n);
          setDraft("");
        }}
      >
        Save
      </Button>
    </div>
  );
}

export default function BunchWeightsPanel({
  vineyardId,
  role,
  blocks,
  rows,
  loading,
  error,
}: {
  vineyardId: string | null;
  role: string | null;
  blocks: BunchWeightBlock[];
  rows: YieldBunchWeightRow[];
  loading?: boolean;
  error?: Error | null;
}) {
  const qc = useQueryClient();
  const canEdit = canEditBunchWeights(role) && !!vineyardId;
  const varieties = useMemo(() => bunchWeightVarieties(blocks), [blocks]);
  // All values start rolled up and visible: a variety's block rows are shown
  // by default, and individual sections can be collapsed on demand.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const allExpanded = collapsed.size === 0;

  const refresh = () => qc.invalidateQueries({ queryKey: [YIELD_BUNCH_WEIGHTS_KEY, vineyardId] });

  const save = useMutation({
    mutationFn: upsertYieldBunchWeight,
    onSuccess: async () => {
      toast({ title: "Bunch weight saved" });
      await refresh();
    },
    onError: (e: any) =>
      toast({ title: "Could not save bunch weight", description: e?.message ?? String(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: softDeleteYieldBunchWeight,
    onSuccess: async () => {
      toast({ title: "Bunch weight removed" });
      await refresh();
    },
    onError: (e: any) =>
      toast({ title: "Could not remove bunch weight", description: e?.message ?? String(e), variant: "destructive" }),
  });
  const busy = save.isPending || remove.isPending;

  const toggle = (k: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  const setAllExpanded = (expand: boolean) =>
    setCollapsed(expand ? new Set() : new Set(varieties.map((v) => v.key)));

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 px-4 pt-4">
        <div className="space-y-1">
          <div className="text-sm font-medium">Master bunch weights</div>
          <p className="text-xs text-muted-foreground">
            Set an average bunch weight (grams) for each variety. Override it for a specific block where
            needed — a block override always wins over the variety master. Blocks without either show
            "Not configured" and Yield Estimate Trips cannot calculate tonnes for them.
            {!canEdit && " Only owners, managers and supervisors can change bunch weights."}
          </p>
        </div>
        {varieties.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            data-testid="bunch-weights-expand-all"
            aria-label={allExpanded ? "Collapse all blocks" : "Expand all blocks"}
            onClick={() => setAllExpanded(!allExpanded)}
          >
            {allExpanded ? "Collapse all" : "Expand all"}
            <ChevronDown className={`h-4 w-4 transition-transform ${allExpanded ? "" : "-rotate-90"}`} />
          </Button>
        )}
      </div>
      {error ? (
        <div className="p-4 text-sm text-destructive">Could not load bunch weights: {error.message}</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Variety / block</TableHead>
              <TableHead className="text-right">Bunch weight</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>{canEdit ? "Set weight" : ""}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Loading…</TableCell>
              </TableRow>
            )}
            {!loading && varieties.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  No varieties are planted in this vineyard's blocks yet.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              varieties.map((v) => {
                const master = resolveBunchWeight(rows, null, v.key);
                const isOpen = !collapsed.has(v.key);
                return (
                  <Fragment key={v.key}>
                    <TableRow data-testid={`variety-row-${v.key}`}>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          aria-label={`${isOpen ? "Collapse" : "Expand"} ${v.name} blocks`}
                          onClick={() => toggle(v.key)}
                        >
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">
                        {v.name}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          ({v.blocks.length} block{v.blocks.length === 1 ? "" : "s"})
                        </span>
                        {v.legacyKey && (
                          <div className="text-[10px] font-normal text-muted-foreground">
                            Legacy planting without a stored variety key
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtG(master.grams)}</TableCell>
                      <TableCell>
                        <SourceBadge source={master.source} />
                      </TableCell>
                      <TableCell>
                        {canEdit && (
                          <WeightEditor
                            label={`${v.name} master bunch weight (g)`}
                            disabled={busy}
                            saving={save.isPending}
                            onSave={(grams) =>
                              save.mutate({
                                vineyardId: vineyardId!,
                                paddockId: null,
                                varietyKey: v.key,
                                varietyName: v.name,
                                grams,
                              })
                            }
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {canEdit && master.recordId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => remove.mutate(master.recordId!)}
                          >
                            Clear
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    {isOpen &&
                      v.blocks.map((b) => {
                        const eff = resolveBunchWeight(rows, b.id, v.key);
                        return (
                          <TableRow key={`${v.key}-${b.id}`} className="bg-muted/30">
                            <TableCell />
                            <TableCell className="pl-6 text-sm">{b.name}</TableCell>
                            <TableCell className="text-right tabular-nums text-sm">
                              {fmtG(eff.grams)}
                              {eff.source === "variety_default" && (
                                <div className="text-[10px] text-muted-foreground">inherited</div>
                              )}
                            </TableCell>
                            <TableCell>
                              <SourceBadge source={eff.source} />
                            </TableCell>
                            <TableCell>
                              {canEdit && (
                                <WeightEditor
                                  label={`${b.name} ${v.name} block override (g)`}
                                  disabled={busy}
                                  saving={save.isPending}
                                  onSave={(grams) =>
                                    save.mutate({
                                      vineyardId: vineyardId!,
                                      paddockId: b.id,
                                      varietyKey: v.key,
                                      varietyName: v.name,
                                      grams,
                                    })
                                  }
                                />
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {canEdit && eff.source === "block_override" && eff.recordId && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => remove.mutate(eff.recordId!)}
                                >
                                  Remove
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </Fragment>
                );
              })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
