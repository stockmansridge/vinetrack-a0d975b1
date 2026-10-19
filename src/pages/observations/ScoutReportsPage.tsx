import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ClipboardList, Loader2, ShieldAlert } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { PageHead } from "@/components/PageHead";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VintageSelect } from "@/components/VintageSelect";
import { useVintageFilter } from "@/hooks/useVintageFilter";
import { formatDate } from "@/lib/dateFormat";
import {
  ALL_BLOCKS,
  ALL_STATUSES,
  checkInsightsAccess,
  fetchScoutVisits,
  filterScoutVisits,
  isPermissionError,
  visitStatuses,
  type ScoutAssessment,
  type ScoutVisit,
} from "@/lib/scoutReports";
import { supabase } from "@/integrations/ios-supabase/client";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  completed: "default",
  draft: "secondary",
};

/** Assessment counts per visit for the list rows (identity = assessment). */
async function fetchAssessmentSummary(
  vineyardId: string,
  visitIds: string[],
): Promise<Map<string, ScoutAssessment[]>> {
  const map = new Map<string, ScoutAssessment[]>();
  if (!visitIds.length) return map;
  const { data, error } = await supabase
    .from("scout_block_assessments" as any)
    .select("id, scout_visit_id, vineyard_id, paddock_id, status, stop_context, deleted_at")
    .eq("vineyard_id", vineyardId)
    .in("scout_visit_id", visitIds)
    .is("deleted_at", null);
  if (error) throw error;
  for (const row of (data ?? []) as unknown as ScoutAssessment[]) {
    const list = map.get(row.scout_visit_id) ?? [];
    list.push(row);
    map.set(row.scout_visit_id, list);
  }
  return map;
}

export default function ScoutReportsPage() {
  const { selectedVineyardId } = useVineyard();
  const vintage = useVintageFilter({ table: "scout_visits", dateColumn: "scout_date" });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL_STATUSES);
  const [blockId, setBlockId] = useState(ALL_BLOCKS);

  // Access preflight: RLS SELECT silently filters disallowed rows, so an
  // empty list is only trustworthy after the backend confirms read access.
  const accessQuery = useQuery({
    queryKey: ["insights-access", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => checkInsightsAccess(selectedVineyardId!),
  });
  const access = accessQuery.data;

  const visitsQuery = useQuery({
    queryKey: ["scout-visits", selectedVineyardId],
    enabled: !!selectedVineyardId && access === "allowed",
    queryFn: () => fetchScoutVisits(selectedVineyardId!),
  });

  const visits = visitsQuery.data ?? [];
  const visitIds = useMemo(() => visits.map((v) => v.id), [visits]);

  const assessmentsQuery = useQuery({
    queryKey: ["scout-assessment-summary", selectedVineyardId, visitIds.join("|")],
    enabled: !!selectedVineyardId && visitIds.length > 0,
    queryFn: () => fetchAssessmentSummary(selectedVineyardId!, visitIds),
  });
  const assessmentsByVisit = assessmentsQuery.data ?? new Map<string, ScoutAssessment[]>();

  const paddocksQuery = useQuery({
    queryKey: ["paddocks-lite", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paddocks")
        .select("id, name")
        .eq("vineyard_id", selectedVineyardId!)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string | null }[];
    },
  });
  const paddockName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of paddocksQuery.data ?? []) m.set(p.id, p.name ?? "Unnamed block");
    return m;
  }, [paddocksQuery.data]);

  const filtered = useMemo(
    () =>
      filterScoutVisits(
        visits,
        { scope: vintage.scope, search, status, blockId },
        assessmentsByVisit,
      ),
    [visits, vintage.scope, search, status, blockId, assessmentsByVisit],
  );

  const statuses = useMemo(() => visitStatuses(visits), [visits]);
  const blockOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const list of assessmentsByVisit.values()) {
      for (const a of list) if (a.paddock_id) ids.add(a.paddock_id);
    }
    return Array.from(ids).sort((a, b) =>
      (paddockName.get(a) ?? "").localeCompare(paddockName.get(b) ?? ""),
    );
  }, [assessmentsByVisit, paddockName]);

  const permissionDenied =
    access === "denied" || (visitsQuery.error && isPermissionError(visitsQuery.error));
  // The preflight itself failed — never show an empty list in this state.
  const accessUnknown = !accessQuery.isLoading && !accessQuery.error && access === "unknown";

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHead
        title="Scout Reports — VineTrack Portal"
        description="Read-only scout reports synced from the VineTrack mobile apps."
        path="/observations/scout-reports"
        noindex
      />
      <div>
        <h1 className="text-2xl font-semibold">Scout Reports</h1>
        <p className="text-sm text-muted-foreground">
          Read-only reports synced from the iOS and Android apps. Scouting itself — visits,
          stops, assessments and photos — is captured on mobile only.
        </p>
      </div>

      {permissionDenied ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-6">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">Access to Scout Reports is restricted</p>
              <p className="text-sm text-muted-foreground">
                The shared database currently limits Scout Reports to System Administrators.
                A permission update for vineyard members has been proposed and is awaiting
                approval. This is a permissions state, not an empty history — your synced
                scout reports have not been lost.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : accessQuery.isLoading || (access === "allowed" && (visitsQuery.isLoading || vintage.isLoading)) ? (
        <div className="flex items-center gap-2 p-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading scout reports…
        </div>
      ) : accessUnknown || accessQuery.error ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            We couldn't confirm your access to Scout Reports. Check your connection and try
            again — an empty list is only shown once access is confirmed.
          </CardContent>
        </Card>
      ) : visitsQuery.error ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Scout reports could not be loaded: {(visitsQuery.error as Error).message}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <VintageSelect
              vintage={vintage.vintage}
              options={vintage.options}
              onChange={vintage.setVintage}
            />
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 w-full sm:w-[140px]" aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
                  {statuses.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Block</Label>
              <Select value={blockId} onValueChange={setBlockId}>
                <SelectTrigger className="h-9 w-full sm:w-[170px]" aria-label="Block">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BLOCKS}>All blocks</SelectItem>
                  {blockOptions.map((id) => (
                    <SelectItem key={id} value={id}>
                      {paddockName.get(id) ?? "Unnamed block"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[200px] flex-1">
              <Label className="mb-1 block text-xs text-muted-foreground">Search</Label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Scout, summary, date…"
                aria-label="Search scout reports"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
                <ClipboardList className="h-8 w-8 text-muted-foreground" />
                <p className="font-medium">No scout reports match</p>
                <p className="text-sm text-muted-foreground">
                  Scout visits recorded on the mobile apps appear here once they have synced.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((v: ScoutVisit) => {
                const stops = assessmentsByVisit.get(v.id) ?? [];
                const blocks = Array.from(
                  new Set(stops.map((a) => a.paddock_id).filter(Boolean) as string[]),
                ).map((id) => paddockName.get(id) ?? "Unnamed block");
                return (
                  <Card key={v.id}>
                    <CardContent className="flex flex-wrap items-center gap-3 p-4">
                      <div className="min-w-[180px] flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{formatDate(v.scout_date)}</span>
                          <Badge variant={STATUS_VARIANT[v.status] ?? "outline"} className="capitalize">
                            {v.status}
                          </Badge>
                          {v.vintage_year != null && (
                            <span className="text-xs text-muted-foreground">
                              Vintage {v.vintage_year}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {v.scout_name_snapshot ?? "Scout not recorded"}
                          {blocks.length > 0 && <> · {blocks.join(", ")}</>}
                          {" · "}
                          {stops.length} stop{stops.length === 1 ? "" : "s"}
                        </div>
                        {v.visit_summary && (
                          <div className="mt-1 line-clamp-2 text-sm">{v.visit_summary}</div>
                        )}
                      </div>
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/observations/scout-reports/${v.id}`}>View Report</Link>
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
