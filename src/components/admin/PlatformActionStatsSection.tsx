// System Admin → Dashboard: what people are doing across Portal, iOS and
// Android. Reads the read-only admin_platform_action_stats RPC (SQL 257) and
// merges in Soil Analysis activity, which that RPC doesn't cover, from the
// live soil records (src/lib/soilPlatformActivity.ts).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import { loadSoilActivityParticipants, loadSoilActivityStats } from "@/lib/soilPlatformActivity";
import { ActionParticipantsDialog, type ParticipantSelection } from "./ActionParticipantsDialog";

export interface PlatformActionStat {
  action_key: string;
  label: string;
  category: string;
  created_count: number | null;
  edited_count: number | null;
  deleted_count: number | null;
  vineyard_count: number | null;
  user_count: number | null;
  /** Which read can list the records behind these counts. */
  participant_source?: "rpc" | "soil";

}

export const ACTION_RANGES = [
  { key: "1", label: "1 Day", days: 1 },
  { key: "7", label: "7 Days", days: 7 },
  { key: "30", label: "30 Days", days: 30 },
  { key: "90", label: "90 Days", days: 90 },
  { key: "all", label: "All time", days: null },
] as const;

/** Total activity = created + edited + deleted (unknown metrics count as 0). */
export const actionTotal = (r: PlatformActionStat) =>
  Number(r.created_count ?? 0) + Number(r.edited_count ?? 0) + Number(r.deleted_count ?? 0);

export function rankActions(rows: PlatformActionStat[]): PlatformActionStat[] {
  return [...rows].sort((a, b) => actionTotal(b) - actionTotal(a) || a.label.localeCompare(b.label));
}

const fmt = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString());

export function PlatformActionStatsSection() {
  const [range, setRange] = useState<(typeof ACTION_RANGES)[number]["key"]>("1");
  const [selection, setSelection] = useState<ParticipantSelection | null>(null);
  const selectedRange = ACTION_RANGES.find((r) => r.key === range) ?? ACTION_RANGES[0];
  const days = selectedRange.days;
  const q = useQuery({
    queryKey: ["admin", "platform-action-stats", days],
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await (iosSupabase as any).rpc("admin_platform_action_stats", { p_days: days });
      if (error) throw error;
      return (data ?? []) as PlatformActionStat[];
    },
  });
  // Soil Analysis isn't in SQL 257, so its rows come from the live soil
  // records and follow the same period control.
  const soil = useQuery({
    queryKey: ["admin", "soil-platform-activity", days],
    staleTime: 60_000,
    retry: false,
    queryFn: () => loadSoilActivityStats(days),
  });
  // Soil counts list from the soil read, not SQL 257; fetched only while one
  // of their lists is actually open.
  const soilSelection = selection?.source === "soil" ? selection : null;
  const soilParticipants = useQuery({
    queryKey: ["admin", "soil-activity-participants", soilSelection?.action, soilSelection?.kind, soilSelection?.days ?? days],
    enabled: !!soilSelection,
    staleTime: 60_000,
    retry: false,
    queryFn: ({ signal }) =>
      loadSoilActivityParticipants(
        soilSelection!.action,
        soilSelection!.kind,
        soilSelection!.days,
        signal,
      ),
  });

  const rows = useMemo(
    () => rankActions([...(q.data ?? []), ...(soil.data ?? [])]),
    [q.data, soil.data],
  );
  const loading = q.isLoading || soil.isLoading;
  const max = Math.max(1, ...rows.map(actionTotal));
  const grand = rows.reduce((s, r) => s + actionTotal(r), 0);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold">What people are doing</h2>
          <p className="text-xs text-muted-foreground">
            Records added, edited and deleted across Portal, iOS and Android, most active first.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {ACTION_RANGES.map((r) => (
            <Button
              key={r.key}
              size="sm"
              variant={range === r.key ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => { setSelection(null); setRange(r.key); }}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading activity…</div>}
      {q.error && (
        <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-sm text-muted-foreground">
          Activity stats aren't available yet — waiting for the backend update (SQL 257).
        </div>
      )}
      {!loading && !q.error && rows.length === 0 && (
        <div className="text-sm text-muted-foreground">No activity in this period.</div>
      )}

      {rows.length > 0 && (
        <>
          <div className="text-xs text-muted-foreground mb-2">{grand.toLocaleString()} actions in total</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border/60">
                  <th className="py-1.5 pr-3 font-medium">Action</th>
                  <th className="py-1.5 pr-3 font-medium w-1/3">Activity</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Added</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Edited</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Deleted</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Vineyards</th>
                  <th className="py-1.5 font-medium text-right">Users</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const t = actionTotal(r);
                  return (
                    <tr key={r.action_key} className="border-b border-border/40 last:border-0">
                      <td className="py-1.5 pr-3">
                        <div className="font-medium">{r.label}</div>
                        <div className="text-xs text-muted-foreground">{r.category}</div>
                      </td>
                      <td className="py-1.5 pr-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-full bg-muted">
                            <div className="h-2 rounded-full bg-primary" style={{ width: `${(t / max) * 100}%` }} />
                          </div>
                          <span className="text-xs tabular-nums w-12 text-right">{t.toLocaleString()}</span>
                        </div>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(r.created_count)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(r.edited_count)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(r.deleted_count)}</td>
                      {(["vineyards", "users"] as const).map((kind) => {
                        const count = kind === "vineyards" ? r.vineyard_count : r.user_count;
                        // Soil lists come from the soil read, everything else from SQL 257.
                        const source = r.participant_source === "soil" ? ("soil" as const) : ("rpc" as const);
                        return <td key={kind} className={`py-1.5 text-right tabular-nums ${kind === "vineyards" ? "pr-3" : ""}`}>
                          {count == null ? "—" : <Button variant="link" className="h-auto min-w-8 p-0 tabular-nums" aria-label={`${r.label}: ${fmt(count)} ${kind}`} onClick={() => setSelection({ action: r.action_key, label: r.label, kind, expected: Number(count), days, period: selectedRange.label, source })}>{fmt(count)}</Button>}
                        </td>;
                      })}

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            "—" means that record type doesn't track this. Edited counts records changed after they were added.
          </p>
        </>
      )}
      {!soil.isLoading && soil.error && (
        <p className="text-xs text-muted-foreground mt-2">
          Soil Analysis activity isn't available with your current access, so no soil figures are shown.
        </p>
      )}
      {selection && <ActionParticipantsDialog selection={selection} onClose={() => setSelection(null)} soil={selection.source === "soil" ? { data: soilParticipants.data, isLoading: soilParticipants.isLoading || soilParticipants.isFetching, error: soilParticipants.error, refetch: () => void soilParticipants.refetch() } : undefined} />}
    </Card>
  );
}
