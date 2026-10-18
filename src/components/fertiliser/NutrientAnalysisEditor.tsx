// Reusable nutrient-analysis editor (Target Nutrient preview).
//
// LOCAL ONLY: entries live in component state — nothing is written to
// product_nutrient_analysis until authenticated access against the live
// table has been tested (contract §11 blocker). Designed to be dropped into
// the saved Chemical/Product editor later; onSave will then persist rows.
//
// Each entry carries: nutrient key (canonical list or Other + custom name),
// percentage, elemental/oxide basis, w/w vs w/v concentration basis, and a
// source marker distinguishing declared label analysis from manual estimates.

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus } from "lucide-react";
import {
  NUTRIENT_KEYS,
  NUTRIENT_DISPLAY,
  type NutrientAnalysisEntry,
} from "@/lib/targetNutrient";

interface Props {
  entries: NutrientAnalysisEntry[];
  onChange: (next: NutrientAnalysisEntry[]) => void;
  /** Optional id prefix so multiple editors on one page don't collide. */
  idPrefix?: string;
}

const OTHER = "__other__";

function keyOf(e: NutrientAnalysisEntry): string {
  return e.nutrientKey.startsWith("other:") ? OTHER : e.nutrientKey;
}

export function NutrientAnalysisEditor({ entries, onChange, idPrefix = "na" }: Props) {
  const update = (i: number, patch: Partial<NutrientAnalysisEntry>) => {
    const next = entries.map((e, j) => (j === i ? { ...e, ...patch } : e));
    onChange(next);
  };
  const remove = (i: number) => onChange(entries.filter((_, j) => j !== i));
  const add = () =>
    onChange([
      ...entries,
      {
        nutrientKey: "N",
        displayName: NUTRIENT_DISPLAY.N,
        percent: 0,
        analysisBasis: "elemental",
        concentrationBasis: "w/w",
        sourceKind: "manual",
        isPrimary: entries.length === 0,
      },
    ]);

  return (
    <div className="space-y-2" aria-label="Product nutrient analysis">
      {entries.length === 0 && (
        <div className="text-xs text-muted-foreground">
          No nutrients declared yet. Add each nutrient from the product label, or a manual estimate.
        </div>
      )}
      {entries.map((e, i) => {
        const isOther = e.nutrientKey.startsWith("other:");
        return (
          <div
            key={`${idPrefix}-${i}`}
            className="grid grid-cols-2 sm:grid-cols-[1fr_90px_110px_90px_auto] gap-2 items-end rounded-md border p-2"
          >
            <div className="col-span-2 sm:col-span-1">
              <Label className="text-xs">Nutrient</Label>
              <Select
                value={keyOf(e)}
                onValueChange={(v) => {
                  if (v === OTHER) {
                    update(i, { nutrientKey: "other:custom", displayName: "" });
                  } else {
                    update(i, {
                      nutrientKey: v,
                      displayName: NUTRIENT_DISPLAY[v] ?? v,
                    });
                  }
                }}
              >
                <SelectTrigger aria-label={`Nutrient ${i + 1}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NUTRIENT_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k} — {NUTRIENT_DISPLAY[k]}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER}>Other…</SelectItem>
                </SelectContent>
              </Select>
              {isOther && (
                <Input
                  className="mt-1"
                  placeholder="Custom nutrient name"
                  value={e.displayName}
                  onChange={(ev) =>
                    update(i, {
                      displayName: ev.target.value,
                      nutrientKey: `other:${ev.target.value.trim().toLowerCase().replace(/\s+/g, "-") || "custom"}`,
                    })
                  }
                  aria-label={`Custom nutrient name ${i + 1}`}
                />
              )}
            </div>
            <div>
              <Label className="text-xs">Percent</Label>
              <Input
                inputMode="decimal"
                value={e.percent === 0 ? "" : String(e.percent)}
                placeholder="e.g. 16"
                onChange={(ev) => {
                  const n = Number(ev.target.value);
                  update(i, { percent: Number.isFinite(n) ? n : 0 });
                }}
                aria-label={`Percent ${i + 1}`}
              />
            </div>
            <div>
              <Label className="text-xs">Basis</Label>
              <Select
                value={e.analysisBasis}
                onValueChange={(v) => update(i, { analysisBasis: v as NutrientAnalysisEntry["analysisBasis"] })}
              >
                <SelectTrigger aria-label={`Analysis basis ${i + 1}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="elemental">Elemental</SelectItem>
                  <SelectItem value="oxide">Oxide (e.g. K₂O)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Conc. basis</Label>
              <Select
                value={e.concentrationBasis}
                onValueChange={(v) => update(i, { concentrationBasis: v as NutrientAnalysisEntry["concentrationBasis"] })}
              >
                <SelectTrigger aria-label={`Concentration basis ${i + 1}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="w/w">w/w (mass)</SelectItem>
                  <SelectItem value="w/v">w/v (per volume)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Badge
                variant={e.sourceKind === "product_analysis" ? "secondary" : "outline"}
                className="text-xs cursor-pointer select-none"
                title="Click to toggle between declared label analysis and a manual estimate"
                onClick={() =>
                  update(i, {
                    sourceKind: e.sourceKind === "product_analysis" ? "manual" : "product_analysis",
                  })
                }
              >
                {e.sourceKind === "product_analysis" ? "Label" : "Manual"}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(i)}
                aria-label={`Remove nutrient ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-4 w-4 mr-1" /> Add nutrient
        </Button>
        <span className="text-xs text-muted-foreground">
          Preview only — analyses are kept on this screen and not saved yet.
        </span>
      </div>
    </div>
  );
}
