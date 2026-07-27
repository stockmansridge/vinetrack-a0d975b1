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
  normaliseAvailableRows,
  type AvailableRow,
  type AvailableRowBlock,
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

/** Placeholder until the shared SQL 127 estimates land — never computed locally. */
const PENDING_LABEL = "Calculation pending backend update";
const VINE_TIP =
  "Estimated vine count will be calculated from the row length and the block's Vineyard Setup information.";
const EMITTER_TIP =
  "Estimated emitter count will be calculated from row length and the block's configured emitter spacing.";


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
    <label className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b border-border px-3 py-2 last:border-0 hover:bg-muted/40 sm:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,130px)_repeat(2,minmax(0,110px))_minmax(0,1.2fr)]">
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
          <Unavailable
            label="Length unavailable"
            tip="This row does not have complete mapped start and end points."
          />
        )}
      </span>
      <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
        {row.vine_count != null ? (
          row.vine_count.toLocaleString()
        ) : (
          <Unavailable label={PENDING_LABEL} tip={VINE_TIP} />
        )}
      </span>
      <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
        {row.emitter_count != null ? (
          row.emitter_count.toLocaleString()
        ) : (
          <Unavailable label={PENDING_LABEL} tip={EMITTER_TIP} />
        )}
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
}: {
  payload: unknown;
  currentValveId?: string | null;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  loading?: boolean;
  error?: Error | null;
  /** Server-reported basis; drives the row-length explanation message only. */
  weightingBasis?: string | null;
}) {
  const [search, setSearch] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const blocks: AvailableRowBlock[] = useMemo(
    () => normaliseAvailableRows(payload, currentValveId),
    [payload, currentValveId],
  );

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
    return (
      <PortalNotice
        variant="error"
        title="Couldn't load vineyard rows"
        description={error.message}
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
            description="Row length is currently used to divide the valve's water. Per-row vine and emitter counts are not yet available."
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
                    <div className="hidden grid-cols-[auto_minmax(0,1.2fr)_minmax(0,130px)_repeat(2,minmax(0,110px))_minmax(0,1.2fr)] gap-3 border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
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
