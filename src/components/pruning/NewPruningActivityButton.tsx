// Shared "New Pruning Activity" create action.
//
// Availability rule (mirrors the create RPC's own authority check —
// record_pruning_entry requires an owner/manager membership on the
// vineyard): the button is ALWAYS rendered. It is never hidden because of
// block selection, filters, empty lists, season setup or loading state.
//   - permissions still loading -> disabled, spinner label
//   - permission denied         -> disabled + explanation tooltip
//   - allowed                   -> opens the block picker, then the
//                                  Record Pruning dialog for that block
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Search, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  usePruningSeasons, usePruningSegments, resolvePruningSeasonId,
  type PruningSeason,
} from "@/lib/pruningQuery";
import { pruningSeasonId } from "@/lib/pruningSeasonId";
import { buildRowIdentities, buildRowCompletion } from "@/lib/pruningCalc";
import { parseRows, parseVarietyAllocations } from "@/lib/paddockGeometry";
import CompleteTodayDialog from "@/components/pruning/CompleteTodayDialog";

interface PickerPaddock {
  id: string;
  name: string | null;
  rows: any;
  polygon_points: any;
  vine_spacing: number | null;
  vine_count_override: number | null;
  variety_allocations: any;
}

function usePickerPaddocks(vineyardId: string | null) {
  return useQuery({
    queryKey: ["pruning", "paddocks", vineyardId],
    enabled: !!vineyardId,
    queryFn: async (): Promise<PickerPaddock[]> => {
      const { data, error } = await supabase
        .from("paddocks")
        .select("id, name, rows, polygon_points, vine_spacing, vine_count_override, variety_allocations")
        .eq("vineyard_id", vineyardId!)
        .is("deleted_at", null)
        .order("name", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as PickerPaddock[];
    },
  });
}

function primaryVariety(p: PickerPaddock): string {
  const allocs = parseVarietyAllocations(p.variety_allocations);
  if (!allocs.length) return "";
  return [...allocs].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0]?.variety ?? "";
}

/** Roles allowed to create a pruning entry — same authority the
 *  `record_pruning_entry` RPC enforces server-side. */
const CREATE_ROLES = new Set(["owner", "manager"]);

export function useCanCreatePruningActivity() {
  const { currentRole, loading, selectedVineyardId } = useVineyard();
  return {
    loading,
    allowed: !!selectedVineyardId && !!currentRole && CREATE_ROLES.has(currentRole),
    role: currentRole,
    hasVineyard: !!selectedVineyardId,
  };
}

interface Props {
  seasonYear: number;
  /** Pre-select a block (e.g. when already inside a block detail view). */
  paddockId?: string | null;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "secondary";
  className?: string;
  label?: string;
}

export default function NewPruningActivityButton({
  seasonYear, paddockId = null, size = "sm", variant = "default", className, label = "New Pruning Activity",
}: Props) {
  const { selectedVineyardId } = useVineyard();
  const { loading, allowed, role, hasVineyard } = useCanCreatePruningActivity();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [ensuring, setEnsuring] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);

  const paddocksQ = usePickerPaddocks(pickerOpen || recordOpen ? selectedVineyardId : null);
  const seasonsQ = usePruningSeasons(pickerOpen || recordOpen ? selectedVineyardId : null);

  useEffect(() => {
    setChosenId(null);
    setRecordOpen(false);
    setPickerOpen(false);
  }, [selectedVineyardId]);

  const paddocks = paddocksQ.data ?? [];
  const chosen = paddocks.find((p) => p.id === chosenId) ?? null;

  const season: PruningSeason | null = useMemo(() => {
    if (!chosenId || !selectedVineyardId) return null;
    const live = (seasonsQ.data ?? []).find(
      (s) => s.paddock_id === chosenId && s.season_year === seasonYear,
    );
    if (live) return live;
    // Synthesised placeholder using the deterministic id — the row itself is
    // created by `ensureSeason` before the dialog opens.
    return {
      id: pruningSeasonId(selectedVineyardId, chosenId, seasonYear),
      vineyard_id: selectedVineyardId,
      paddock_id: chosenId,
      season_year: seasonYear,
      start_date: null,
      due_date: null,
      pruning_method: "spur",
      assigned_crew: "",
      working_days: [1, 2, 3, 4, 5],
      manual_row_count: null,
      estimated_labour_hours: null,
      notes: "",
      status: "active",
      created_at: "",
      updated_at: "",
      deleted_at: null,
    } as PruningSeason;
  }, [chosenId, selectedVineyardId, seasonsQ.data, seasonYear]);

  const segmentsQ = usePruningSegments(recordOpen && season ? season.id : null);

  const identities = useMemo(
    () => (chosen ? buildRowIdentities(parseRows(chosen.rows), chosen, null) : []),
    [chosen],
  );
  const completion = useMemo(
    () => buildRowCompletion(identities, (segmentsQ.data ?? []) as any),
    [identities, segmentsQ.data],
  );

  const openBlock = async (id: string) => {
    if (!selectedVineyardId) return;
    setChosenId(id);
    setEnsuring(true);
    try {
      const resolved = await resolvePruningSeasonId(selectedVineyardId, id, seasonYear);
      if (!resolved.existed) {
        const { error } = await supabase.from("pruning_seasons").insert({
          id: resolved.id,
          vineyard_id: selectedVineyardId,
          paddock_id: id,
          season_year: seasonYear,
          pruning_method: "spur",
          assigned_crew: "",
          working_days: [1, 2, 3, 4, 5],
          notes: "",
          status: "active",
          client_updated_at: new Date().toISOString(),
        });
        if (error && !/duplicate|unique/i.test(error.message)) throw error;
      }
      await seasonsQ.refetch();
    } catch {
      // Non-fatal: the record RPC adopts/creates the canonical season itself.
    } finally {
      setEnsuring(false);
      setPickerOpen(false);
      setRecordOpen(true);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return paddocks;
    return paddocks.filter(
      (p) => (p.name ?? "").toLowerCase().includes(q) || primaryVariety(p).toLowerCase().includes(q),
    );
  }, [paddocks, search]);

  const disabled = loading || !allowed;
  const deniedReason = !hasVineyard
    ? "Select a vineyard to record pruning."
    : `Recording pruning requires an Owner or Manager role${role ? ` — your role is ${role}` : ""}.`;

  const button = (
    <Button
      size={size}
      variant={variant}
      className={className}
      disabled={disabled}
      onClick={() => {
        if (paddockId) void openBlock(paddockId);
        else setPickerOpen(true);
      }}
    >
      {loading ? (
        <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Checking access…</>
      ) : !allowed ? (
        <><ShieldAlert className="h-4 w-4 mr-1" /> {label}</>
      ) : (
        <><Plus className="h-4 w-4 mr-1" /> {label}</>
      )}
    </Button>
  );

  return (
    <>
      {disabled && !loading ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild><span className="inline-flex">{button}</span></TooltipTrigger>
            <TooltipContent>{deniedReason}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        button
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New pruning activity</DialogTitle>
            <DialogDescription>Choose the block this activity was worked on.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search blocks or varieties…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1 space-y-1">
            {paddocksQ.isLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading blocks…</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No matching blocks.</div>
            ) : (
              filtered.map((p) => {
                const rowsCount = parseRows(p.rows).length;
                const variety = primaryVariety(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={ensuring}
                    onClick={() => void openBlock(p.id)}
                    className="w-full text-left rounded-md border p-3 transition hover:bg-muted/60 disabled:opacity-60"
                  >
                    <div className="font-medium">{p.name ?? "Unnamed block"}</div>
                    <div className="text-xs text-muted-foreground">
                      {rowsCount > 0 ? `${rowsCount} rows` : "No rows configured"}
                      {variety ? ` · ${variety}` : ""}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {recordOpen && season && chosen && selectedVineyardId && (
        <CompleteTodayDialog
          open={recordOpen}
          onOpenChange={(o) => { setRecordOpen(o); if (!o) setChosenId(null); }}
          season={season}
          vineyardId={selectedVineyardId}
          paddockId={chosen.id}
          paddockName={chosen.name ?? "Block"}
          rows={completion}
        />
      )}
    </>
  );
}
