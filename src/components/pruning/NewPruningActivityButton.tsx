// Shared "New Pruning Activity" create action (SQL 166 parent activity).
//
// Availability rule (mirrors the create RPC's own authority check —
// record_pruning_activity requires an owner/manager membership on the
// vineyard): the button is ALWAYS rendered. It is never hidden because of
// block selection, filters, empty lists, season setup or loading state.
//   - permissions still loading -> disabled, spinner label
//   - permission denied         -> disabled + explanation tooltip
//   - allowed                   -> opens the multi-block activity editor
import { useEffect, useState } from "react";
import { Loader2, Plus, ShieldAlert } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import PruningActivityDialog from "@/components/pruning/PruningActivityDialog";

/** Roles allowed to create a pruning activity — the same authority the
 *  `record_pruning_activity` RPC enforces server-side. */
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
  seasonYear, paddockId = null, size = "sm", variant = "default", className,
  label = "New Pruning Activity",
}: Props) {
  const { selectedVineyardId } = useVineyard();
  const { loading, allowed, role, hasVineyard } = useCanCreatePruningActivity();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [selectedVineyardId]);

  const disabled = loading || !allowed;
  const deniedReason = !hasVineyard
    ? "Select a vineyard to record pruning."
    : `Recording pruning requires an Owner or Manager role${role ? ` — your role is ${role}` : ""}.`;

  const button = (
    <Button size={size} variant={variant} className={className} disabled={disabled} onClick={() => setOpen(true)}>
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

      {open && selectedVineyardId && (
        <PruningActivityDialog
          open={open}
          onOpenChange={setOpen}
          vineyardId={selectedVineyardId}
          seasonYear={seasonYear}
          paddockId={paddockId}
        />
      )}
    </>
  );
}
