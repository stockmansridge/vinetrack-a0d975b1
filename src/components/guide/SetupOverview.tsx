import { Card } from "@/components/ui/card";
import { Info } from "lucide-react";
import { SetupStatusPill } from "./SetupCard";

interface OverviewTile {
  key: string;
  label: string;
  caption: string;
}

const TILES: OverviewTile[] = [
  {
    key: "core_setup",
    label: "Core setup completion",
    caption:
      "Will be calculated from verified vineyard data (blocks, boundaries, rows, planting, weather, team, equipment).",
  },
  {
    key: "platform_readiness",
    label: "Platform readiness",
    caption:
      "Will report whether the team is actually using iOS, Android and the portal together.",
  },
  {
    key: "tools_explored",
    label: "Tools explored",
    caption:
      "Will track which of the thirteen shared operational tools this vineyard has used.",
  },
];

/**
 * Stage 2 overview. Deliberately shows NO percentage — nothing here may be
 * mistaken for a real vineyard health figure. Stage 3 connects live data.
 */
export function SetupOverview() {
  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((t) => (
          <Card key={t.key} className="flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13px] font-semibold text-foreground">{t.label}</p>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight text-muted-foreground/50">
                —
              </span>
              <SetupStatusPill status="not_checked" />
            </div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{t.caption}</p>
          </Card>
        ))}
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-3 text-[12.5px] text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Internal build note: setup-health is not calculated yet. No completion figure on
          this page is derived from vineyard data, and no percentage is displayed. Live
          checks are connected in a later stage using the existing data-coverage source and
          the established irrigation capability information.
        </p>
      </div>
    </div>
  );
}
