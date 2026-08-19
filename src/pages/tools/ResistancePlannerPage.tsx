// Stage 4 — Resistance Planner landing screen.
//
// The landing screen is a PLAN LIST, never an auto-opened plan: SQL 196 allows
// several plans for the same season and disease, so the portal always makes the
// user choose one by its stable ID.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, FileWarning, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useVineyard } from "@/context/VineyardContext";
import { useVintage } from "@/lib/useVintage";
import { formatDate } from "@/lib/dateFormat";
import { ResistancePlanEditor } from "@/components/resistance/ResistancePlanEditor";
import {
  duplicatePlan,
  emptyPlan,
  rulesetDrift,
  type ResistancePlan,
} from "@/lib/resistancePlanContract";
import { fetchResistancePlans, softDeleteResistancePlan } from "@/lib/resistancePlanQuery";
import {
  currentRuleset,
  DISEASE_LABEL,
  jurisdictionFromCountryCode,
  type ResistanceDisease,
} from "@/lib/resistance/resistanceRuleset";
import { RESISTANCE_REGISTRY } from "@/lib/resistance/resistanceRulesets";
import {
  makeSeasonCalendar,
  seasonForEpochMs,
  seasonIdForStartYear,
} from "@/lib/resistance/resistanceSeason";

const ALL = "__all__";

export default function ResistancePlannerPage() {
  const { selectedVineyardId, currentCountry } = useVineyard();
  const { seasonStartMonth, seasonStartDay, countryCode } = useVintage();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [editing, setEditing] = useState<ResistancePlan | null>(null);
  const [seasonFilter, setSeasonFilter] = useState<string>(ALL);
  const [diseaseFilter, setDiseaseFilter] = useState<string>(ALL);
  const [confirmDelete, setConfirmDelete] = useState<ResistancePlan | null>(null);

  const plansQ = useQuery({
    queryKey: ["resistance-plans", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchResistancePlans(selectedVineyardId!),
  });
  const plans = plansQ.data ?? [];

  const jurisdiction = jurisdictionFromCountryCode(countryCode ?? currentCountry);
  const seasonCalendar = useMemo(
    () => makeSeasonCalendar({ startMonth: seasonStartMonth, startDay: seasonStartDay }),
    [seasonStartMonth, seasonStartDay],
  );
  const currentSeasonId = seasonIdForStartYear(
    seasonForEpochMs(seasonCalendar, Date.now()).startYear,
  );

  const deleteMut = useMutation({
    mutationFn: (id: string) => softDeleteResistancePlan(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resistance-plans", selectedVineyardId] });
      toast({ title: "Plan archived" });
      setConfirmDelete(null);
    },
    onError: (e: any) =>
      toast({ title: "Plan not archived", description: e?.message, variant: "destructive" }),
  });

  const filtered = plans.filter(
    (p) =>
      (seasonFilter === ALL || p.seasonId === seasonFilter) &&
      (diseaseFilter === ALL || String(p.disease) === diseaseFilter),
  );

  const seasons = Array.from(new Set(plans.map((p) => p.seasonId))).sort().reverse();

  if (!selectedVineyardId) {
    return <p className="p-6 text-sm text-muted-foreground">Select a vineyard to plan resistance.</p>;
  }

  if (editing) {
    return (
      <div className="p-4 md:p-6">
        <ResistancePlanEditor
          key={editing.id || "new"}
          initial={editing}
          onClose={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["resistance-plans", selectedVineyardId] });
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Resistance Planner</h1>
          <p className="text-sm text-muted-foreground">
            Plan a season's activity-group sequence and check it against your recorded sprays.
          </p>
        </div>
        <Button
          onClick={() =>
            setEditing(
              emptyPlan({
                vineyardId: selectedVineyardId,
                seasonId: currentSeasonId,
                disease: "powdery_mildew",
                jurisdiction,
              }),
            )
          }
        >
          <Plus className="mr-1 h-4 w-4" /> Create plan
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={seasonFilter} onValueChange={setSeasonFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All seasons" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All seasons</SelectItem>
            {seasons.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={diseaseFilter} onValueChange={setDiseaseFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All diseases" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All diseases</SelectItem>
            {(["powdery_mildew", "downy_mildew"] as ResistanceDisease[]).map((d) => (
              <SelectItem key={d} value={d}>
                {DISEASE_LABEL[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {plansQ.isLoading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading plans…
        </p>
      )}
      {plansQ.error && (
        <p className="text-sm text-destructive">
          Plans could not be loaded: {(plansQ.error as Error).message}
        </p>
      )}

      {!plansQ.isLoading && filtered.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No resistance plans yet for this vineyard.
        </div>
      )}

      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Season</TableHead>
                <TableHead>Disease</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>Blocks</TableHead>
                <TableHead>Positions</TableHead>
                <TableHead>Ruleset</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const ruleset = currentRuleset(
                  RESISTANCE_REGISTRY,
                  jurisdiction,
                  "grape",
                  p.disease as ResistanceDisease,
                );
                const drift = rulesetDrift(p, {
                  id: ruleset?.id ?? null,
                  version: ruleset?.rulesetVersion ?? null,
                });
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.seasonId}</TableCell>
                    <TableCell>
                      {DISEASE_LABEL[p.disease as ResistanceDisease] ?? String(p.disease)}
                    </TableCell>
                    <TableCell>{p.jurisdiction ?? "—"}</TableCell>
                    <TableCell>{p.blockIds.length}</TableCell>
                    <TableCell>{p.positions.length}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.rulesetId ?? "—"}
                      {p.rulesetVersion ? ` · ${p.rulesetVersion}` : ""}
                    </TableCell>
                    <TableCell>
                      {drift.drifted ? (
                        <Badge variant="outline" className="gap-1">
                          <FileWarning className="h-3 w-3" /> Ruleset update available
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Current</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.updatedAt ? formatDate(new Date(p.updatedAt)) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                          Open
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Duplicate plan"
                          onClick={() => setEditing(duplicatePlan(p))}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Archive plan"
                          onClick={() => setConfirmDelete(p)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this resistance plan?</AlertDialogTitle>
            <AlertDialogDescription>
              The plan is soft-deleted, exactly as the mobile apps expect, and stays in the
              historical record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && deleteMut.mutate(confirmDelete.id)}
              disabled={deleteMut.isPending}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
