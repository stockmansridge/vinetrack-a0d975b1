// Provenance popover for one block's seasonal base estimate (SQL 221).
//
// Everything shown here comes from the database contract — the Portal only
// adds the damage adjustment line, which is its own engine.
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  setupWarningLabel,
  type SeasonYieldBlockEstimate,
} from "@/lib/seasonYieldContract";

const num = (v: unknown, digits = 2): string =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString(undefined, { maximumFractionDigits: digits })
    : "—";

const SOURCE_LABELS: Record<string, string> = {
  pruning_calculator: "Pruning Yield Calculator (shared with the mobile apps)",
  bunch_count: "Bunch Count sampling",
};

const PRUNING_FIELDS: { key: string; label: string; digits?: number }[] = [
  { key: "prune_method", label: "Prune method" },
  { key: "vine_count", label: "Vines", digits: 0 },
  { key: "vines_per_ha", label: "Vines / ha", digits: 0 },
  { key: "buds_per_vine", label: "Buds per vine", digits: 2 },
  { key: "spurs_per_vine", label: "Spurs per vine", digits: 2 },
  { key: "buds_per_spur", label: "Buds per spur", digits: 2 },
  { key: "canes_per_vine", label: "Canes per vine", digits: 2 },
  { key: "buds_per_cane", label: "Buds per cane", digits: 2 },
  { key: "bunches_per_bud", label: "Bunches per bud", digits: 2 },
  { key: "bunch_weight_grams", label: "Bunch weight (g)", digits: 1 },
];

export default function BlockEstimateInfo({
  block,
  supersededByBunchCount = false,
}: {
  block: SeasonYieldBlockEstimate;
  /** A completed Bunch Count Trip is providing the displayed estimate. */
  supersededByBunchCount?: boolean;
}) {
  const inputs = (block.sourceInputs ?? {}) as Record<string, unknown>;
  const rows = PRUNING_FIELDS.filter((f) => inputs[f.key] != null).map((f) => ({
    label: f.label,
    value:
      typeof inputs[f.key] === "number"
        ? num(inputs[f.key], f.digits ?? 2)
        : String(inputs[f.key]),
  }));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground"
          aria-label={`Estimate details for ${block.blockName ?? "block"}`}
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 text-xs">
        <div>
          <div className="text-sm font-medium">{block.blockName ?? "Block"}</div>
          <div className="text-muted-foreground">
            {supersededByBunchCount
              ? "Bunch Count Trip estimate (supersedes the base estimate)"
              : SOURCE_LABELS[block.estimateSource ?? ""] ??
                block.estimateSource ??
                "No estimate source"}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <span className="text-muted-foreground">Base estimate</span>
          <span className="text-right tabular-nums">
            {block.baseTonnes == null ? "—" : `${num(block.baseTonnes)} t`}
          </span>
          <span className="text-muted-foreground">Damage adjustment</span>
          <span className="text-right tabular-nums">
            {block.damageApplied
              ? `−${num(block.damageLossPct, 1)}% (${block.damageRecordCount} record${
                  block.damageRecordCount === 1 ? "" : "s"
                })`
              : block.damageRecordCount > 0
              ? "Not applied"
              : "None recorded"}
          </span>
          <span className="text-muted-foreground">Adjusted estimate</span>
          <span className="text-right tabular-nums">
            {block.tonnes == null ? "—" : `${num(block.tonnes)} t`}
          </span>
          <span className="text-muted-foreground">Calculated</span>
          <span className="text-right">
            {block.calculatedAt ? new Date(block.calculatedAt).toLocaleString() : "—"}
          </span>
        </div>

        {rows.length > 0 && (
          <div className="space-y-1">
            <div className="font-medium">Pruning inputs</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {rows.map((r) => (
                <div key={r.label} className="contents">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="text-right tabular-nums">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {block.warnings.length > 0 && (
          <div className="space-y-1">
            <div className="font-medium">Setup warnings</div>
            <ul className="space-y-1">
              {block.warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5">
                  <Badge variant="outline" className="mt-[1px] shrink-0 text-[10px]">
                    !
                  </Badge>
                  <span className="text-muted-foreground">{setupWarningLabel(w)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
