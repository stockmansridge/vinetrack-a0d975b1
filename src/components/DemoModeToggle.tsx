import { EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDemoMode } from "@/context/DemoModeContext";
import { useIsSystemAdminRaw } from "@/lib/systemAdmin";

/**
 * System-admin-only toggle: hides every System Admin gated surface so the
 * portal renders exactly as a Vineyard Owner would see it.
 */
export function DemoModeToggle() {
  const { isAdmin } = useIsSystemAdminRaw();
  const { demoMode, toggleDemoMode } = useDemoMode();
  if (!isAdmin) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleDemoMode}
      aria-pressed={demoMode}
      aria-label={demoMode ? "Exit demo mode" : "Enter demo mode"}
      title={
        demoMode
          ? "Demo mode on — System Admin tools hidden. Click to exit."
          : "Demo mode — view the portal as a vineyard owner"
      }
      className="rounded-full"
    >
      <EyeOff className="h-4 w-4" />
    </Button>
  );
}
