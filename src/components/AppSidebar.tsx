import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { BrandName } from "@/components/BrandName";
import {
  LayoutDashboard,
  Activity,
  Map,
  Tractor,
  Gauge,
  Users,
  FileBarChart,
  CloudRain,
  FolderOpen,
  Route,
  Cloud,
  MapPin,
  Wrench,
  ClipboardList,
  Beaker,
  Layers,
  UserCog,
  Sprout,
  Database,
  Droplet,
  Grape,
  AlertTriangle,
  Fuel,
  LifeBuoy,
  DollarSign,
  ShieldCheck,
  Bell,
  Flag,
  ChevronDown,
  Hammer,
  FileText,
  Settings as SettingsIcon,
  Mail,
} from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { useVineyardLogo } from "@/hooks/useVineyardLogo";
import { BrandMark } from "@/components/BrandMark";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SupportRequestSheet } from "@/components/support/SupportRequestSheet";
import { cn } from "@/lib/utils";

type NavItem = { id: string; title: string; url: string; icon: any };
type NavSection = {
  id: string;
  label: string;
  icon: any;
  items: NavItem[];
  adminOnly?: boolean;
  systemAdminOnly?: boolean;
};

const SECTIONS: NavSection[] = [
  {
    id: "operations",
    label: "Operations",
    icon: Activity,
    items: [
      { id: "trips", title: "Field Trips", url: "/trips", icon: Sprout },
      { id: "pins", title: "Pins / Repairs / Observations", url: "/pins", icon: MapPin },
      { id: "tasks", title: "Task Log", url: "/work-tasks", icon: ClipboardList },
      { id: "maint", title: "Maintenance Logs", url: "/maintenance", icon: Wrench },
      { id: "fuel", title: "Fuel Purchases", url: "/fuel-purchases", icon: Fuel },
      { id: "irrigation", title: "Irrigation Advisor", url: "/tools/irrigation", icon: Droplet },
    ],
  },
  {
    id: "spray",
    label: "Spray & Compliance",
    icon: Layers,
    items: [
      { id: "spray-jobs", title: "Spray Jobs & Templates", url: "/spray-jobs", icon: Layers },
      { id: "spray-reports", title: "Spray Records / Reports", url: "/reports/spray", icon: FileBarChart },
      { id: "chemicals", title: "Chemicals", url: "/setup/chemicals", icon: Beaker },
      { id: "documents", title: "Documents & Exports", url: "/reports/documents", icon: FolderOpen },
    ],
  },
  {
    id: "setup",
    label: "Vineyard Setup",
    icon: SettingsIcon,
    items: [
      { id: "vineyard", title: "Vineyard Settings", url: "/setup/vineyard", icon: Grape },
      { id: "vineyard-loc", title: "Vineyard Location", url: "/setup/vineyard-location", icon: MapPin },
      { id: "paddocks", title: "Blocks / Paddocks", url: "/setup/paddocks", icon: Map },
      { id: "varieties", title: "Grape Varieties", url: "/setup/grape-varieties", icon: Grape },
      { id: "spray-eq", title: "Spray Equipment", url: "/setup/spray-equipment", icon: Gauge },
      { id: "other-eq", title: "Other Equipment", url: "/setup/equipment-other", icon: Hammer },
      { id: "tractors", title: "Tractors", url: "/setup/tractors", icon: Tractor },
      { id: "op-cat", title: "Operator Categories", url: "/setup/operator-categories", icon: UserCog },
      { id: "saved-inputs", title: "Saved Inputs", url: "/setup/saved-inputs", icon: Sprout },
      { id: "weather", title: "Weather Settings", url: "/setup/weather", icon: Cloud },
    ],
  },
  {
    id: "reports",
    label: "Reports & Insights",
    icon: FileText,
    items: [
      { id: "trip-reports", title: "Trip Reports", url: "/reports/trips", icon: Route },
      { id: "rainfall", title: "Rainfall Reports", url: "/reports/rainfall", icon: CloudRain },
      { id: "growth", title: "Growth Stage Records", url: "/reports/growth-stage", icon: Sprout },
      { id: "yield", title: "Yield Records", url: "/yield", icon: Grape },
      { id: "damage", title: "Damage Records", url: "/damage-records", icon: AlertTriangle },
    ],
  },
  {
    id: "financial",
    label: "Financial",
    icon: DollarSign,
    adminOnly: true,
    items: [
      { id: "costs", title: "Cost Reports", url: "/reports/costs", icon: DollarSign },
      { id: "coverage", title: "Data Coverage", url: "/settings/data-coverage", icon: Database },
    ],
  },
  {
    id: "team",
    label: "Team",
    icon: Users,
    items: [{ id: "team-members", title: "Team Members", url: "/team", icon: Users }],
  },
  {
    id: "system-admin",
    label: "System Admin",
    icon: ShieldCheck,
    systemAdminOnly: true,
    items: [
      { id: "diag", title: "Diagnostics", url: "/admin/dashboard", icon: Activity },
      { id: "flags", title: "Feature Flags", url: "/admin/feature-flags", icon: Flag },
      { id: "notices", title: "App Notices", url: "/admin/notices", icon: Bell },
      { id: "sysadmins", title: "System Admins", url: "/admin/system-admins", icon: ShieldCheck },
      { id: "invites", title: "Invitations", url: "/admin/invitations", icon: Mail },
    ],
  },
];

const STORAGE_KEY = "vt.sidebar.openSections.v2";

function loadOpenState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveOpenState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

// Brand active state — single green
const activeItemClass =
  "data-[active=true]:bg-[hsl(80_58%_46%/0.15)] data-[active=true]:text-[#85B830] data-[active=true]:font-semibold hover:bg-[hsl(80_58%_46%/0.08)]";

export function AppSidebar() {
  const { pathname } = useLocation();
  const [supportOpen, setSupportOpen] = useState(false);
  const { currentRole, memberships, selectedVineyardId } = useVineyard();
  const { isAdmin: isSystemAdmin } = useIsSystemAdmin();
  const { data: logoUrl } = useVineyardLogo();
  const { state: sidebarState } = useSidebar();
  const collapsed = sidebarState === "collapsed";

  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;
  const isAdmin = currentRole === "owner" || currentRole === "manager";

  const visibleSections = useMemo(
    () =>
      SECTIONS.filter((s) => {
        if (s.systemAdminOnly && !isSystemAdmin) return false;
        if (s.adminOnly && !isAdmin) return false;
        return true;
      }),
    [isSystemAdmin, isAdmin],
  );

  const activeSectionId = useMemo(() => {
    const s = SECTIONS.find((sec) => sec.items.some((i) => i.url === pathname));
    return s?.id ?? null;
  }, [pathname]);

  // Initialise once: localStorage + auto-open active section
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => {
    const initial = loadOpenState();
    if (activeSectionId && initial[activeSectionId] === undefined) {
      initial[activeSectionId] = true;
    }
    return initial;
  });

  // When route changes, open the active section ONLY if user hasn't explicitly closed it
  const lastRouteRef = useRef(pathname);
  useEffect(() => {
    if (lastRouteRef.current === pathname) return;
    lastRouteRef.current = pathname;
    if (!activeSectionId) return;
    setOpenMap((prev) => {
      if (prev[activeSectionId] === true) return prev;
      // Only force-open if user has no explicit preference (undefined). Respect explicit false.
      if (prev[activeSectionId] === false) return prev;
      const next = { ...prev, [activeSectionId]: true };
      saveOpenState(next);
      return next;
    });
  }, [pathname, activeSectionId]);

  const setSectionOpen = (id: string, open: boolean) => {
    setOpenMap((prev) => {
      if (prev[id] === open) return prev;
      const next = { ...prev, [id]: open };
      saveOpenState(next);
      return next;
    });
  };

  const isActive = (p: string) => pathname === p;

  // Collapsed (icon) mode — flat icon list
  if (collapsed) {
    const flatItems: NavItem[] = [
      { id: "dashboard", title: "Overview", url: "/dashboard", icon: LayoutDashboard },
      ...visibleSections.flatMap((s) => s.items),
    ];
    return (
      <Sidebar collapsible="icon">
        <SidebarHeader className="px-2 py-3">
          <BrandMark circle logoUrl={logoUrl} size={32} alt={vineyardName ?? "VineTrack"} />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {flatItems.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      isActive={isActive(item.url)}
                      className={cn("rounded-xl", activeItemClass)}
                    >
                      <NavLink to={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="px-2 pb-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Contact support"
                onClick={() => setSupportOpen(true)}
                className="rounded-xl"
              >
                <LifeBuoy className="h-4 w-4" />
                <span>Contact support</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SupportRequestSheet open={supportOpen} onOpenChange={setSupportOpen} />
      </Sidebar>
    );
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-4">
        <div className="flex items-center gap-2 min-w-0">
          <BrandMark circle logoUrl={logoUrl} size={40} alt={vineyardName ?? "VineTrack"} />
          <div className="flex flex-col leading-tight min-w-0">
            <span className="font-semibold tracking-tight text-sidebar-foreground truncate">
              {vineyardName ?? <BrandName />}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">
              Vineyard portal
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-1">
        {/* Dashboard pinned at top */}
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive("/dashboard")}
                  className={cn("rounded-xl", activeItemClass)}
                >
                  <NavLink to="/dashboard" className="flex items-center gap-2">
                    <LayoutDashboard className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">Overview</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {visibleSections.map((section) => {
          const open = openMap[section.id] ?? false;
          const hasActive = section.id === activeSectionId;
          const SectionIcon = section.icon;
          return (
            <SidebarGroup key={section.id} className="py-0.5">
              <Collapsible
                open={open}
                onOpenChange={(o) => setSectionOpen(section.id, o)}
              >
                <CollapsibleTrigger asChild>
                  <SidebarGroupLabel
                    className={cn(
                      "cursor-pointer flex items-center gap-2 h-8 px-2 select-none",
                      "hover:text-sidebar-foreground transition-colors",
                      hasActive && "text-[#85B830]",
                    )}
                  >
                    <SectionIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 truncate">{section.label}</span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                        open ? "rotate-0" : "-rotate-90",
                      )}
                    />
                  </SidebarGroupLabel>
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden">
                  <SidebarGroupContent className="pl-2">
                    <SidebarMenu>
                      {section.items.map((item) => (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive(item.url)}
                            className={cn("rounded-xl", activeItemClass)}
                          >
                            <NavLink to={item.url} className="flex items-center gap-2">
                              <item.icon className="h-4 w-4 shrink-0" />
                              <span className="flex-1 truncate">{item.title}</span>
                            </NavLink>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </Collapsible>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="px-2 pb-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => setSupportOpen(true)}
              className="rounded-xl"
            >
              <LifeBuoy className="h-4 w-4" />
              <span>Contact support</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SupportRequestSheet open={supportOpen} onOpenChange={setSupportOpen} />
    </Sidebar>
  );
}
