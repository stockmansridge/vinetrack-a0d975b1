// Manual spray entry capability.
//
// Deliberately its own capability: the Spray Program planning flag is
// owner/manager only, and reusing it would wrongly exclude Supervisors.
// Backend authorisation remains the authority — this only gates the UI.
import { useVineyard } from "@/context/VineyardContext";

export type ManualSprayRole = string | null | undefined;

const MANUAL_SPRAY_ROLES = new Set(["owner", "manager", "supervisor"]);

/** Owner, Manager and Supervisor of the SELECTED vineyard may enter manual sprays. */
export function canEnterManualSpray(role: ManualSprayRole): boolean {
  return !!role && MANUAL_SPRAY_ROLES.has(role);
}

/** The same capability governs add, edit, delete and the manual report action. */
export const canEditManualSpray = canEnterManualSpray;
export const canDeleteManualSpray = canEnterManualSpray;
export const canExportManualSprayReport = canEnterManualSpray;

export const MANUAL_SPRAY_DENIED_MESSAGE =
  "Only vineyard owners, managers and supervisors can record a manual spray.";

export function useCanEnterManualSpray(): boolean {
  const { currentRole } = useVineyard();
  return canEnterManualSpray(currentRole);
}
