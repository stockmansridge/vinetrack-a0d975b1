import { useEffect, useState } from "react";
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
  ClipboardCheck,
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

type NavItem = { title: string; url: string; icon: any };
type NavSection = {
  id: string;
  label: string;
  icon: any;
  items: NavItem[];
  adminOnly?: boolean; // owner/manager
  systemAdminOnly?: boolean;
};

const sections: NavSection[] = [
  {
    id: "operations",
    label: "Operations",
    icon: Activity,
    items: [
      { title: "Live Dashboard", url: "/dashboard/live", icon: Activity },
      { title: "Field Trips", url: "/trips", icon: Sprout },
      { title: "Pins / Repairs / Observations", url: "/pins", icon: MapPin },
      { title: "Task Log", url: "/work-tasks", icon: ClipboardList },
      { title: "Maintenance Logs", url: "/maintenance", icon: Wrench },
      { title: "Fuel Purchases", url: "/fuel-purchases", icon: Fuel },
      { title: "Irrigation Advisor", url: "/tools/irrigation", icon: Droplet },
    ],
  },
  {
    id: "spray",
    label: "Spray & Compliance",
    icon: Layers,
    items: [
      { title: "Spray Jobs & Templates", url: "/spray-jobs", icon: Layers },
      { title: "Spray Records / Reports", url: "/reports/spray", icon: FileBarChart },
      { title: "Chemicals", url: "/setup/chemicals", icon: Beaker },
      { title: "Documents & Exports", url: "/reports/documents", icon: FolderOpen },
    ],
  },
  {
    id: "setup",
    label: "Vineyard Setup",
    icon: SettingsIcon,
    items: [
      { title: "Vineyard Settings", url: "/setup/vineyard", icon: Grape },
      { title: "Vineyard Location", url: "/setup/vineyard-location", icon: MapPin },
      { title: "Blocks / Paddocks", url: "/setup/paddocks", icon: Map },
      { title: "Grape Varieties", url: "/setup/grape-varieties", icon: Grape },
      { title: "Spray Equipment", url: "/setup/spray-equipment", icon: Gauge },
      { title: "Other Equipment", url: "/setup/equipment-other", icon: Hammer },
      { title: "Tractors", url: "/setup/tractors", icon: Tractor },
      { title: "Operator Categories", url: "/setup/operator-categories", icon: UserCog },
      { title: "Saved Inputs", url: "/setup/saved-inputs", icon: Sprout },
      { title: "Weather Settings", url: "/setup/weather", icon: Cloud },
    ],
  },
  {
    id: "reports",
    label: "Reports & Insights",
    icon: FileText,
    items: [
      { title: "Trip Reports", url: "/reports/trips", icon: Route },
      { title: "Rainfall Reports", url: "/reports/rainfall", icon: CloudRain },
      { title: "Growth Stage Records", url: "/reports/growth-stage", icon: Sprout },
      { title: "Yield Records", url: "/yield", icon: Grape },
      { title: "Damage Records", url: "/damage-records", icon: AlertTriangle },
    ],
  },
  {
    id: "reports-admin",
    label: "Financial",
    icon: DollarSign,
    adminOnly: true,
    items: [
      { title: "Cost Reports", url: "/reports/costs", icon: DollarSign },
      { title: "Data Coverage", url: "/settings/data-coverage", icon: Database },
    ],
  },
  {
    id: "team",
    label: "Team",
    icon: Users,
    items: [
      { title: "Team Members", url: "/team", icon: Users },
    ],
  },
  {
    id: "system-admin",
    label: "System Admin",
    icon: ShieldCheck,
    systemAdminOnly: true,
    items: [
      { title: "Diagnostics", url: "/admin/dashboard", icon: Activity },
      { title: "Feature Flags", url: "/admin/feature-flags", icon: Flag },
      { title: "App Notices", url: "/admin/notices", icon: Bell },
      { title: "System Admins", url: "/admin/system-admins", icon: ShieldCheck },
      { title: "Invitations", url: "/admin/invitations", icon: Mail },
    ],
  },
];

const STORAGE_KEY = "vt.sidebar.openSections.v1";

function loadOpenState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, boolean>;
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

  const visibleSections = sections.filter((s) => {
    if (s.systemAdminOnly && !isSystemAdmin) return false;
    if (s.adminOnly && !isAdmin) return false;
    return true;
  });

  const sectionHasActive = (s: NavSection) => s.items.some((i) => pathname === i.url);

  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => loadOpenState());

  // Auto-open active section
  useEffect(() => {
    const active = visibleSections.find(sectionHasActive);
    if (active && !openMap[active.id]) {
      setOpenMap((prev) => {
        const next = { ...prev, [active.id]: true };
        saveOpenState(next);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggleSection = (id: string) => {
    setOpenMap((prev) => {
      const next = { ...prev, [id]: !(prev[id] ?? false) };
      saveOpenState(next);
      return next;
    });
  };

  const isActive = (p: string) => pathname === p;

  const activeItemClass =
    "data-[active=true]:bg-accent data-[active=true]:text-primary data-[active=true]:font-bold data-[active=true]:hover:bg-accent data-[active=true]:hover:text-primary hover:bg-[hsl(80_58%_46%/0.10)] hover:text-white";

  // When sidebar is icon-collapsed, render a flat icon list (one button per section's first/primary item, plus dashboard) with tooltips
  if (collapsed) {
    const flatItems: NavItem[] = [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
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
                  <SidebarMenuItem key={item.url}>
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
                className="rounded-xl hover:bg-[hsl(80_58%_46%/0.10)] hover:text-white"
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
        <div className="flex items-center gap-2">
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
      <SidebarContent>
        {/* Dashboard pinned at top */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive("/dashboard")}
                  className={cn("rounded-xl", activeItemClass)}
                >
                  <NavLink to="/dashboard" className="flex items-center gap-2">
                    <LayoutDashboard className="h-4 w-4" />
                    <span className="flex-1 truncate">Dashboard</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {visibleSections.map((section) => {
          const hasActive = sectionHasActive(section);
          const open = openMap[section.id] ?? hasActive;
          const SectionIcon = section.icon;
          return (
            <SidebarGroup key={section.id}>
              <Collapsible open={open} onOpenChange={() => toggleSection(section.id)}>
                <CollapsibleTrigger asChild>
                  <SidebarGroupLabel
                    className={cn(
                      "group/label cursor-pointer flex items-center gap-2 hover:text-sidebar-foreground transition-colors",
                      hasActive && "text-primary",
                    )}
                  >
                    <SectionIcon className="h-3.5 w-3.5" />
                    <span className="flex-1">{section.label}</span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        open ? "rotate-0" : "-rotate-90",
                      )}
                    />
                  </SidebarGroupLabel>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {section.items.map((item) => (
                        <SidebarMenuItem key={item.url}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive(item.url)}
                            className={cn("rounded-xl", activeItemClass)}
                          >
                            <NavLink to={item.url} className="flex items-center gap-2">
                              <item.icon className="h-4 w-4" />
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
              className="rounded-xl hover:bg-[hsl(80_58%_46%/0.10)] hover:text-white"
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
