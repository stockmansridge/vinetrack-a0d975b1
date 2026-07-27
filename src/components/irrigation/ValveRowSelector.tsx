// Valve → vineyard row selector (SQL 126).
//
// Rows come from `list_irrigation_available_rows` (backed by paddocks.rows) and
// are grouped by the real paddock record returned by the RPC. Nothing here
// computes weightings or hydraulic percentages — saving calls
// `set_irrigation_valve_rows` and the server response is rendered verbatim.
// The only locally derived figure is "block coverage", which is descriptive
// (selected rows ÷ available rows) and clearly labelled as such.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PortalNotice } from "@/components/ui/PortalNotice";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  blockCoveragePercent,
  emitterBasisLabel,
  formatEstimate,
  vineBasisLabel,
  type AvailableRow,
  type AvailableRowBlock,
  normaliseAvailableRows,
} from "@/lib/irrigationRows";


function Unavailable({ tip, label = "Not available" }: { tip: string; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help text-muted-foreground underline decoration-dotted underline-offset-2">
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{tip}</TooltipContent>
    </Tooltip>
  );
}

const MISSING_GEOMETRY_TIP =
  "This row does not have complete mapped start and end points, so row length and related estimates cannot be calculated.";

/** Renders a SQL 127 count with its basis explanation. Never shows null as zero. */
function CountCell({
  value,
  isEstimated,
  basisText,
  unavailableLabel,
  noun,
}: {
  value: number | null;
  isEstimated: boolean | null;
  basisText: string | null;
  unavailableLabel: string;
  noun: string;
}) {
  const text = formatEstimate(value, isEstimated);
  if (text == null) {
    return (
      <Unavailable
        label={unavailableLabel}
        tip={basisText ? `${noun}: ${basisText}` : MISSING_GEOMETRY_TIP}
      />
    );
  }
  const tip = basisText ?? (isEstimated ? "Estimated by the vineyard backend." : "Exact value.");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-2">{text}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{tip}</TooltipContent>
    </Tooltip>
  );
}

function RowLine({
  row,
  checked,
  onToggle,
}: {
  row: AvailableRow;
  checked: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <label className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b border-border px-3 py-2 last:border-0 hover:bg-muted/40 sm:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,120px)_repeat(2,minmax(0,150px))_minmax(0,1.2fr)]">
      <Checkbox
        checked={checked}
        onCheckedChange={(c) => onToggle(!!c)}
        aria-label={`Row ${row.row_label ?? row.row_number ?? row.row_id}`}
      />
      <span className="text-sm font-medium tabular-nums">
        {row.row_label ?? `Row ${row.row_number ?? "—"}`}
      </span>
      <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
        {row.row_length_m != null ? (
          `${row.row_length_m.toLocaleString()} m`
        ) : (
          <Unavailable label="Length unavailable" tip={MISSING_GEOMETRY_TIP} />
        )}
      </span>
      <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
        <CountCell
          value={row.vine_count}
          isEstimated={row.vine_count_is_estimated}
          basisText={vineBasisLabel(row.vine_count_basis)}
          unavailableLabel="Vines unavailable"
          noun="Vine count"
        />
      </span>
      <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
        <CountCell
          value={row.emitter_count}
          isEstimated={row.emitter_count_is_estimated}
          basisText={emitterBasisLabel(row.emitter_count_basis)}
          unavailableLabel="Emitters unavailable"
          noun="Emitter count"
        />
      </span>


      <span className="truncate text-xs text-muted-foreground">
        {row.other_valve_names.length > 0 ? `Also on ${row.other_valve_names.join(", ")}` : ""}
      </span>
    </label>
  );
}

export function ValveRowSelector({
  payload,
  currentValveId,
  selected,
  onChange,
  loading,
  error,
  weightingBasis,
  expandedBlockIds,
}: {
  payload: unknown;
  currentValveId?: string | null;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  loading?: boolean;
  error?: Error | null;
  /** Server-reported basis; drives the row-length explanation message only. */
  weightingBasis?: string | null;
  /** Blocks that already hold saved rows — these open expanded. */
  expandedBlockIds?: string[];
}) {
  const [search, setSearch] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [seeded, setSeeded] = useState(false);

  const blocks: AvailableRowBlock[] = useMemo(
    () => normaliseAvailableRows(payload, currentValveId),
    [payload, currentValveId],
  );

  // Blocks start collapsed; only those with a saved selection open on load, so
  // a large vineyard doesn't dump every row on screen.
  const expandedKey = (expandedBlockIds ?? []).join(",");
  useEffect(() => {
    if (seeded || blocks.length === 0) return;
    const open = new Set(expandedBlockIds ?? []);
    setCollapsed(Object.fromEntries(blocks.map((b) => [b.block_id, !open.has(b.block_id)])));
    setSeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks.length, expandedKey, seeded]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return blocks
      .map((b) => {
        const blockMatches = q ? b.block_name.toLowerCase().includes(q) : true;
        const rows = b.rows.filter((r) => {
          if (selectedOnly && !selected.has(r.row_id)) return false;
          if (!q) return true;
          if (blockMatches) return true;
          const label = (r.row_label ?? "").toLowerCase();
          return label.includes(q) || String(r.row_number ?? "").includes(q);
        });
        return { ...b, rows };
      })
      .filter((b) => b.rows.length > 0);
  }, [blocks, search, selectedOnly, selected]);

  const toggleRow = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };

  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };

  if (error) {
    // A backend-side fault (e.g. a missing SQL 127 helper) must not look like a
    // portal bug, and must never be shown as "0 rows".
    const backendFault = /does not exist|function .*\(/i.test(error.message);
    return (
      <PortalNotice
        variant="error"
        title="Couldn't load vineyard rows"
        description={
          <>
            <div>{error.message}</div>
            {backendFault && (
              <div className="mt-1">
                This is a vineyard backend error, not a saved-configuration problem. Your existing
                row connections are unchanged — row selection will work again once the backend
                function is fixed.
              </div>
            )}
          </>
        }
      />
    );
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading vineyard rows…</div>;
  if (blocks.length === 0) {
    return (
      <PortalNotice
        variant="warning"
        title="No vineyard rows available"
        description="This vineyard has no rows recorded against its blocks, so rows cannot be linked to a valve yet."
      />
    );
  }

  const showRowLengthNote = weightingBasis === "row_length";

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3">
        {showRowLengthNote && (
          <PortalNotice
            compact
            variant="info"
            description="Row length is the allocation basis returned by the backend for this valve. Vine and emitter figures below are estimates and do not change how the water is divided."
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search row number, label or block…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant={selectedOnly ? "default" : "outline"}
            onClick={() => setSelectedOnly((v) => !v)}
          >
            Selected only
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setCollapsed({})}>
            Expand all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setCollapsed(Object.fromEntries(blocks.map((b) => [b.block_id, true])))}
          >
            Collapse all
          </Button>
        </div>

        <div className="max-h-[480px] space-y-3 overflow-y-auto rounded-lg border border-border p-2">
          {filtered.map((b) => {
            const allBlock = blocks.find((x) => x.block_id === b.block_id)?.rows ?? b.rows;
            const totalInBlock = allBlock.length;
            const selectedInBlock = allBlock.filter((r) => selected.has(r.row_id)).length;
            const coverage = blockCoveragePercent(selectedInBlock, totalInBlock);
            const ids = b.rows.map((r) => r.row_id);
            const isCollapsed = !!collapsed[b.block_id];
            return (
              <div key={b.block_id} className="rounded-lg border border-border">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 px-3 py-2">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 text-left"
                    onClick={() => setCollapsed((c) => ({ ...c, [b.block_id]: !c[b.block_id] }))}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    )}
                    <span className="truncate text-sm font-semibold">{b.block_name}</span>
                    {b.variety_name && (
                      <span className="truncate text-xs text-muted-foreground">
                        {b.variety_name}
                      </span>
                    )}
                  </button>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="tabular-nums">
                      Selected rows: {selectedInBlock} of {totalInBlock}
                    </Badge>
                    <Badge variant="outline" className="tabular-nums">
                      Block coverage: {coverage == null ? "—" : `${coverage.toFixed(1)}%`}
                    </Badge>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setMany(ids, true)}>
                      Select all
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setMany(ids, false)}>
                      Clear
                    </Button>
                  </div>
                </div>

                {!isCollapsed && (
                  <>
                    <div className="hidden grid-cols-[auto_minmax(0,1.2fr)_minmax(0,120px)_repeat(2,minmax(0,150px))_minmax(0,1.2fr)] gap-3 border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
                      <span />
                      <span>Row</span>
                      <span>Length</span>
                      <span>Vines</span>
                      <span>Emitters</span>
                      <span>Other valve</span>
                    </div>
                    {b.rows.map((r) => (
                      <RowLine
                        key={r.row_id}
                        row={r}
                        checked={selected.has(r.row_id)}
                        onToggle={(v) => toggleRow(r.row_id, v)}
                      />
                    ))}
                  </>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No rows match this search.
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
