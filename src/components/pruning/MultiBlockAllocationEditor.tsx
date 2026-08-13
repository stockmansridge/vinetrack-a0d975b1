// Multi-block pruning allocation editor.
//
// Left panel  : every active block in the vineyard (searchable). Blocks with
//               selections are marked and stay in the list.
// Main panel  : the active block's row/quarter grid.
// Summary     : per-block row ranges + quarter counts and combined totals.
//
// Selections are held in a map keyed by block id, so switching blocks NEVER
// discards work already done in another block. This component is pure UI +
// state: persistence happens through the parent activity endpoint (see
// src/lib/pruningActivityContract.ts).
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, Plus, Search, Square, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { parseRows, parseVarietyAllocations } from "@/lib/paddockGeometry";
import { buildRowIdentities, buildRowCompletion, type RowIdentity } from "@/lib/pruningCalc";
import { usePruningSeasons, usePruningSegments } from "@/lib/pruningQuery";
import {
  allocationKey, allocationQuarterCount, allocationRowEquivalents, allocationRowSummary, allocationVines,
  type BlockAllocationDraft,
} from "@/lib/pruningActivityContract";

const QUARTERS = [1, 2, 3, 4] as const;

interface EditorPaddock {
  id: string;
  name: string | null;
  rows: any;
  polygon_points: any;
  vine_spacing: number | null;
  vine_count_override: number | null;
  variety_allocations: any;
}

function useEditorPaddocks(vineyardId: string | null) {
  return useQuery({
    queryKey: ["pruning", "paddocks", vineyardId],
    enabled: !!vineyardId,
    queryFn: async (): Promise<EditorPaddock[]> => {
      const { data, error } = await supabase
        .from("paddocks")
        .select("id, name, rows, polygon_points, vine_spacing, vine_count_override, variety_allocations")
        .eq("vineyard_id", vineyardId!)
        .is("deleted_at", null)
        .order("name", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as EditorPaddock[];
    },
  });
}

function primaryVariety(p: EditorPaddock): string {
  const allocs = parseVarietyAllocations(p.variety_allocations);
  if (!allocs.length) return "";
  return [...allocs].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0]?.variety ?? "";
}

interface Props {
  vineyardId: string;
  seasonYear: number;
  /** Allocation map keyed by block id — owned by the parent. */
  value: Record<string, BlockAllocationDraft>;
  onChange: (next: Record<string, BlockAllocationDraft>) => void;
  /** Quarters already owned by THIS activity (edit mode), keyed blockId -> "row:q". */
  ownedByActivity?: Record<string, Set<string>>;
  /** Optionally open on a specific block (e.g. from a block detail page). */
  initialPaddockId?: string | null;
  disabled?: boolean;
}

export default function MultiBlockAllocationEditor({
  vineyardId, seasonYear, value, onChange, ownedByActivity, initialPaddockId = null, disabled,
}: Props) {
  const paddocksQ = useEditorPaddocks(vineyardId);
  const seasonsQ = usePruningSeasons(vineyardId);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const paddocks = paddocksQ.data ?? [];
  const active = paddocks.find((p) => p.id === activeId) ?? null;

  // Open on the requested block once (and on the first allocation in edit mode).
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (autoOpened || !paddocks.length) return;
    const target = initialPaddockId ?? Object.keys(value)[0] ?? null;
    if (!target) return;
    setAutoOpened(true);
    setActiveId(target);
  }, [autoOpened, paddocks.length, initialPaddockId, value]);

  const activeSeason = useMemo(
    () => (seasonsQ.data ?? []).find((s) => s.paddock_id === activeId && s.season_year === seasonYear) ?? null,
    [seasonsQ.data, activeId, seasonYear],
  );
  const segmentsQ = usePruningSegments(activeSeason?.id ?? null);

  const identities = useMemo(
    () => (active ? buildRowIdentities(parseRows(active.rows), active, null) : []),
    [active],
  );
  const completion = useMemo(
    () => buildRowCompletion(identities, (segmentsQ.data ?? []) as any),
    [identities, segmentsQ.data],
  );

  const owned = (activeId && ownedByActivity?.[activeId]) || new Set<string>();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return paddocks;
    return paddocks.filter(
      (p) => (p.name ?? "").toLowerCase().includes(q) || primaryVariety(p).toLowerCase().includes(q),
    );
  }, [paddocks, search]);

  const ensureAllocation = (p: EditorPaddock): BlockAllocationDraft =>
    value[p.id] ?? {
      paddockId: p.id,
      paddockName: p.name ?? "Unnamed block",
      variety: primaryVariety(p),
      quarters: {},
      seasonId: null,
    };

  const setAllocation = (a: BlockAllocationDraft) => onChange({ ...value, [a.paddockId]: a });

  const addBlock = (p: EditorPaddock) => {
    setActiveId(p.id);
    if (!value[p.id]) setAllocation(ensureAllocation(p));
  };

  const removeBlock = (paddockId: string) => {
    const next = { ...value };
    delete next[paddockId];
    onChange(next);
    if (activeId === paddockId) setActiveId(null);
  };

  const clearBlock = (paddockId: string) => {
    const a = value[paddockId];
    if (!a) return;
    setAllocation({ ...a, quarters: {} });
  };

  const toggleQuarter = (identity: RowIdentity, quarter: number) => {
    if (!active || disabled) return;
    const a = ensureAllocation(active);
    const key = allocationKey(identity.rowNumber, quarter);
    const quarters = { ...a.quarters };
    if (quarters[key]) delete quarters[key];
    else quarters[key] = {
      rowNumber: identity.rowNumber,
      segmentNumber: quarter,
      paddockRowId: identity.paddockRowId,
      rowLabel: identity.rowLabel,
        vines: (identity.estimatedVines ?? 0) / 4,
    };
    setAllocation({ ...a, quarters });
  };

  const toggleRow = (identity: RowIdentity, availableQuarters: number[]) => {
    if (!active || disabled) return;
    const a = ensureAllocation(active);
    const quarters = { ...a.quarters };
    const allSelected = availableQuarters.every((q) => quarters[allocationKey(identity.rowNumber, q)]);
    for (const q of availableQuarters) {
      const key = allocationKey(identity.rowNumber, q);
      if (allSelected) delete quarters[key];
      else quarters[key] = {
        rowNumber: identity.rowNumber,
        segmentNumber: q,
        paddockRowId: identity.paddockRowId,
        rowLabel: identity.rowLabel,
        vines: (identity.estimatedVines ?? 0) / 4,
        effVines: (identity.effectiveVines ?? identity.estimatedVines ?? 0) / 4,
      };
    }
    setAllocation({ ...a, quarters });
  };

  const allocations = Object.values(value);
  const totalQuarters = allocations.reduce((s, a) => s + allocationQuarterCount(a), 0);
  const totalVines = allocations.reduce((s, a) => s + allocationVines(a), 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_260px]">
      {/* ---------------- Left: all active blocks ---------------- */}
      <div className="space-y-2 min-w-0">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8 h-9"
            placeholder="Search blocks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="rounded-md border divide-y max-h-[46vh] overflow-y-auto">
          {paddocksQ.isLoading ? (
            <div className="p-3 text-sm text-muted-foreground">Loading blocks…</div>
          ) : filtered.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">No matching blocks.</div>
          ) : (
            filtered.map((p) => {
              const a = value[p.id];
              const count = a ? allocationQuarterCount(a) : 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addBlock(p)}
                  className={cn(
                    "w-full text-left p-2.5 transition hover:bg-muted/60",
                    activeId === p.id && "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">{p.name ?? "Unnamed block"}</span>
                    {a && <Badge variant={count > 0 ? "default" : "outline"}>{count}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {primaryVariety(p) || "No variety set"}
                    {a ? ` · ${allocationRowSummary(a)}` : ""}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ---------------- Main: row / quarter grid ---------------- */}
      <div className="min-w-0 space-y-2">
        {!active ? (
          <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
            Select a block on the left to choose its rows and quarters.
            Selections in other blocks are kept.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{active.name ?? "Unnamed block"}</div>
                <div className="text-xs text-muted-foreground">
                  {primaryVariety(active) || "No variety set"} · {identities.length} rows
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => clearBlock(active.id)}>
                  <X className="h-4 w-4 mr-1" /> Clear block
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled || !value[active.id]}
                  onClick={() => removeBlock(active.id)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Remove from activity
                </Button>
              </div>
            </div>

            <div className="rounded-md border divide-y max-h-[46vh] overflow-y-auto">
              {identities.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No rows configured for this block.
                </div>
              )}
              {completion.map((r) => {
                const ownedHere = (q: number) => owned.has(allocationKey(r.identity.rowNumber, q));
                const availableQuarters = QUARTERS.filter((q) => !r.completed.has(q) || ownedHere(q));
                const sel = value[active.id]?.quarters ?? {};
                const allSel = availableQuarters.length > 0
                  && availableQuarters.every((q) => sel[allocationKey(r.identity.rowNumber, q)]);
                return (
                  <div
                    key={r.identity.paddockRowId ?? r.identity.rowNumber}
                    className="grid grid-cols-[52px_40px_repeat(4,minmax(0,1fr))] items-center gap-2 px-2 py-1.5 hover:bg-muted/30"
                  >
                    <div className="text-sm font-medium tabular-nums">{r.identity.rowLabel}</div>
                    <button
                      type="button"
                      disabled={disabled || availableQuarters.length === 0}
                      onClick={() => toggleRow(r.identity, availableQuarters as unknown as number[])}
                      aria-label={`Toggle all quarters in row ${r.identity.rowLabel}`}
                      className="h-9 w-9 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
                    >
                      {allSel ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                    {QUARTERS.map((q) => {
                      const locked = r.completed.has(q) && !ownedHere(q);
                      const isSel = !!sel[allocationKey(r.identity.rowNumber, q)];
                      return (
                        <button
                          key={q}
                          type="button"
                          disabled={disabled || locked}
                          onClick={() => toggleQuarter(r.identity, q)}
                          aria-pressed={isSel}
                          aria-label={`Row ${r.identity.rowLabel} quarter ${q}${locked ? " (recorded by another activity)" : ""}`}
                          className={cn(
                            "h-9 w-full rounded-md border text-xs font-medium tabular-nums transition",
                            locked
                              ? "bg-zinc-200 dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600 text-muted-foreground cursor-not-allowed shadow-inner"
                              : isSel
                              ? "bg-emerald-500 border-emerald-600 text-white shadow-sm"
                              : "bg-muted/40 border-input text-foreground/70 hover:bg-muted",
                          )}
                        >
                          Q{q}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ---------------- Right: allocation summary ---------------- */}
      <div className="space-y-2 min-w-0">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Allocations</div>
        <div className="rounded-md border divide-y">
          {allocations.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">No blocks added yet.</div>
          ) : (
            allocations.map((a) => (
              <div key={a.paddockId} className="p-2.5 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="text-left text-sm font-medium hover:underline truncate"
                    onClick={() => setActiveId(a.paddockId)}
                  >
                    {a.paddockName}
                  </button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    disabled={disabled}
                    onClick={() => removeBlock(a.paddockId)}
                    aria-label={`Remove ${a.paddockName} from activity`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {allocationRowSummary(a)} · {allocationQuarterCount(a)} quarter
                  {allocationQuarterCount(a) === 1 ? "" : "s"} · {allocationRowEquivalents(a).toFixed(2)} row eq.
                </div>
              </div>
            ))
          )}
        </div>
        <div className="rounded-md border p-3 space-y-1 bg-muted/20 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Blocks</span><span className="tabular-nums font-medium">{allocations.length}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Quarters</span><span className="tabular-nums font-medium">{totalQuarters}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Row equivalents</span><span className="tabular-nums font-medium">{(totalQuarters / 4).toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Vines</span><span className="tabular-nums font-medium">~{totalVines.toLocaleString()}</span></div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Labour, times, worker, method, notes and the linked Work Task belong to the
          activity and are counted once, never per block.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={disabled}
          onClick={() => setActiveId(null)}
        >
          <Plus className="h-4 w-4 mr-1" /> Add another block
        </Button>
      </div>
    </div>
  );
}
