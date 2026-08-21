// One badge per issue, saying exactly what action is available.
import { AlertTriangle, PencilLine, RefreshCw, ShieldCheck, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MASTER_ACTION_LABEL, type MasterActionKind } from "@/lib/masterReviewActions";

const STYLE: Record<MasterActionKind, { cls: string; Icon: typeof AlertTriangle }> = {
  resolved_automatically: {
    cls: "border-transparent bg-secondary text-secondary-foreground",
    Icon: ShieldCheck,
  },
  refresh_from_apvma: {
    cls: "border-transparent bg-warning/15 text-warning-foreground",
    Icon: RefreshCw,
  },
  admin_correction_available: {
    cls: "border-transparent bg-primary/15 text-primary",
    Icon: PencilLine,
  },
  admin_decision_required: {
    cls: "border-transparent bg-destructive/15 text-destructive",
    Icon: AlertTriangle,
  },
  not_manually_resolvable: {
    cls: "border-transparent bg-muted text-muted-foreground",
    Icon: Lock,
  },
};

export function MasterActionBadge({ kind }: { kind: MasterActionKind }) {
  const { cls, Icon } = STYLE[kind];
  return (
    <Badge className={`${cls} text-[10px] gap-1 whitespace-nowrap`}>
      <Icon className="h-3 w-3" /> {MASTER_ACTION_LABEL[kind]}
    </Badge>
  );
}
