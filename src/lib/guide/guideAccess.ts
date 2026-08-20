// How VineTrack Works — Stage 5B role-aware access preparation.
//
// PURPOSE: one authoritative place that answers "what should THIS viewer see
// inside the guide?". It is *presentation* logic only:
//   - it never grants access to a destination — `canAccessRoute` (page role
//     matrix), `RequireSystemAdmin` and RLS remain the authorities,
//   - it never duplicates the role matrix — it delegates to
//     `@/lib/rolePermissions`,
//   - it does not activate customer access. The parent route stays System
//     Admin-only until the Stage 5B report is accepted; these helpers simply
//     make the eventual flip a one-line change instead of an audit.
//
// The guide holds two kinds of content:
//   A. general learning content (workflows, tools, reports, platforms)
//   B. Setup Health (live, permission-scoped vineyard configuration state)
// Lower-permission roles get (A) in full and (B) read-only, without actions
// they cannot complete.

import { canAccessRoute, type Role } from "@/lib/rolePermissions";
import type { HowVineTrackWorksItem } from "@/lib/guide/howVineTrackWorksCatalogue";

export interface GuideViewer {
  /** Sydney / System Admin — sees internal review content and diagnostics. */
  isSystemAdmin: boolean;
  /** The viewer's role on the selected vineyard, if any. */
  role: Role | null;
}

/** Roles proposed to receive the sidebar entry and the guide routes. */
export const GUIDE_VIEW_ROLES: Role[] = ["owner", "manager", "supervisor", "operator"];

/** Roles that can actually complete Core Setup work (owner/manager). */
export const SETUP_MANAGE_ROLES: Role[] = ["owner", "manager"];

/**
 * Portal routes that exist but are intentionally System Admin-only in
 * navigation (no route-level role matrix entry yet). The guide must not become
 * a shortcut to them — see the Stage 5B report, Fertiliser Calculator item.
 */
export const SYSTEM_ADMIN_ONLY_ROUTES = new Set<string>([
  "/tools/fertiliser-calculator",
  "/tools/satellite-mapping",
]);

export function isSetupManager(viewer: GuideViewer): boolean {
  return (
    viewer.isSystemAdmin || (!!viewer.role && SETUP_MANAGE_ROLES.includes(viewer.role))
  );
}

/** Whether the viewer may open How VineTrack Works at all (prepared, not live). */
export function canViewGuide(viewer: GuideViewer): boolean {
  return viewer.isSystemAdmin || (!!viewer.role && GUIDE_VIEW_ROLES.includes(viewer.role));
}

/** Setup Health is visible to every role; only the affordances differ. */
export function setupHealthMode(viewer: GuideViewer): "manage" | "read_only" {
  return isSetupManager(viewer) ? "manage" : "read_only";
}

/** Internal/unclassified catalogue entries (Mapping, Crop Health) and badges. */
export function showsInternalContent(viewer: GuideViewer): boolean {
  return viewer.isSystemAdmin;
}

/** "Internal preview", diagnostics, tool IDs, availability labels. */
export function showsDevelopmentLabels(viewer: GuideViewer): boolean {
  return viewer.isSystemAdmin;
}

/** Setup health diagnostics — independently System Admin-gated. */
export function showsSetupDiagnostics(viewer: GuideViewer): boolean {
  return viewer.isSystemAdmin;
}

/** Guide Images management is permanently System Admin-only. */
export function canManageGuideImages(viewer: GuideViewer): boolean {
  return viewer.isSystemAdmin;
}

/**
 * Can this viewer actually open a guide destination?
 * Delegates to the portal's page role matrix; System Admin-only nav routes are
 * hidden from customer roles so the guide never advertises a dead end.
 */
export function canOpenGuideRoute(route: string, viewer: GuideViewer): boolean {
  if (viewer.isSystemAdmin) return true;
  if (SYSTEM_ADMIN_ONLY_ROUTES.has(route)) return false;
  return canAccessRoute(route, viewer.role ?? null);
}

export interface GuideActionDecision {
  /** Render the link. */
  show: boolean;
  /** Customer-safe explanation to show instead of the link, when useful. */
  hint?: string;
}

const ASK_MANAGER_HINT = "Ask an Owner or Manager to complete this setup.";

/** Decision for a Setup Health row action ("Open"). */
export function setupActionDecision(
  route: string | undefined,
  viewer: GuideViewer,
): GuideActionDecision {
  if (!route) return { show: false };
  if (canOpenGuideRoute(route, viewer)) return { show: true };
  return { show: false, hint: ASK_MANAGER_HINT };
}

/** Decision for a general guide action ("Open in portal", "Open tool"). */
export function guideActionDecision(
  route: string | undefined,
  viewer: GuideViewer,
): GuideActionDecision {
  if (!route) return { show: false };
  return canOpenGuideRoute(route, viewer)
    ? { show: true }
    : { show: false, hint: "Your vineyard role doesn't have access to this portal screen." };
}

/** Filter catalogue items so internal/unclassified entries stay admin-only. */
export function visibleGuideItems<T extends HowVineTrackWorksItem>(
  items: T[],
  viewer: GuideViewer,
): T[] {
  if (showsInternalContent(viewer)) return items;
  return items.filter(
    (i) => i.availability === "available" && i.visibilityGate !== "system_admin",
  );
}

/** The Stage 5B proposed matrix, kept in code so tests can assert it. */
export const GUIDE_ROLE_MATRIX: Record<
  "system_admin" | Role,
  {
    guide: boolean;
    sidebar: boolean;
    learningContent: boolean;
    setupHealth: "manage" | "read_only" | "hidden";
    internalContent: boolean;
    diagnostics: boolean;
    guideImages: boolean;
  }
> = {
  system_admin: {
    guide: true,
    sidebar: true,
    learningContent: true,
    setupHealth: "manage",
    internalContent: true,
    diagnostics: true,
    guideImages: true,
  },
  owner: {
    guide: true,
    sidebar: true,
    learningContent: true,
    setupHealth: "manage",
    internalContent: false,
    diagnostics: false,
    guideImages: false,
  },
  manager: {
    guide: true,
    sidebar: true,
    learningContent: true,
    setupHealth: "manage",
    internalContent: false,
    diagnostics: false,
    guideImages: false,
  },
  supervisor: {
    guide: true,
    sidebar: true,
    learningContent: true,
    setupHealth: "read_only",
    internalContent: false,
    diagnostics: false,
    guideImages: false,
  },
  operator: {
    guide: true,
    sidebar: true,
    learningContent: true,
    setupHealth: "read_only",
    internalContent: false,
    diagnostics: false,
    guideImages: false,
  },
};
