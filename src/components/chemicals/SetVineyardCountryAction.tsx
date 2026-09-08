// Shared recovery action shown wherever chemical lookup is blocked because the
// selected vineyard has no country. It never relaxes the guard — it only takes
// Owners/Managers to the vineyard profile Country field and back again.
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useVineyard } from "@/context/VineyardContext";
import {
  ASK_OWNER_MANAGER_MESSAGE,
  SET_VINEYARD_COUNTRY_LABEL,
  VINEYARD_COUNTRY_PROMPT,
  VINEYARD_COUNTRY_SETTINGS_TARGET,
  canEditVineyardCountry,
  saveCountryReturnContext,
} from "@/lib/vineyardCountryRecovery";

export function SetVineyardCountryAction({
  returnLabel = "chemicals",
  capture,
  className,
}: {
  /** Label used by the return action on the settings page. */
  returnLabel?: string;
  /** Host state to preserve (search text, unsaved draft, spray context). */
  capture?: () => Record<string, unknown>;
  className?: string;
}) {
  const { currentRole } = useVineyard();
  // Some chemical surfaces are embedded outside a router (dialogs rendered by
  // hosts, tests). The prompt must still render; only the jump is unavailable.
  const inRouter = useInRouterContext();
  const navigate = inRouter ? useNavigate() : null;
  const location = inRouter ? useLocation() : null;
  const canEdit = canEditVineyardCountry(currentRole);

  const go = () => {
    let state: Record<string, unknown> | undefined;
    try {
      state = capture?.();
    } catch {
      state = undefined;
    }
    if (!navigate || !location) return;
    saveCountryReturnContext({
      path: `${location.pathname}${location.search}`,
      label: returnLabel,
      state,
    });
    navigate(VINEYARD_COUNTRY_SETTINGS_TARGET);
  };

  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <p className="text-[11px]">{VINEYARD_COUNTRY_PROMPT}</p>
      {canEdit && inRouter ? (
        <Button type="button" size="sm" variant="outline" onClick={go}>
          {SET_VINEYARD_COUNTRY_LABEL}
        </Button>
      ) : (
        <p className="text-[11px] text-muted-foreground">{ASK_OWNER_MANAGER_MESSAGE}</p>
      )}
    </div>
  );
}
