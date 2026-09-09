// "Add manual spray" entry point. Visible only to roles that hold the manual
// spray capability (owner, manager, supervisor) — this is deliberately NOT the
// owner/manager-only Spray Program editing flag.
import { Link } from "react-router-dom";
import { PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCanEnterManualSpray } from "@/lib/manualSpray/permissions";

export function ManualSprayEntryButton({ variant = "outline" as const }) {
  const canEnter = useCanEnterManualSpray();
  if (!canEnter) return null;
  return (
    <Button asChild variant={variant} size="sm">
      <Link to="/spray-records/manual/new">
        <PencilLine className="h-4 w-4 mr-1" /> Add manual spray
      </Link>
    </Button>
  );
}
