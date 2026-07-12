import { useState } from "react";
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
  Satellite,
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
  LayoutDashboard as AdminDashIcon,
  Bell,
  Flag,
  ChevronDown,
  Globe2,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useVineyard } from "@/context/VineyardContext";
import { canAccessRoute } from "@/lib/rolePermissions";
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
import { SupportRequestSheet } from "@/components/support/SupportRequestSheet";
import { useUnresolvedSupportCount } from "@/lib/supportRequestsCount";

type NavItem = { title: string; url: string; icon: any; soon?: boolean };

const dashboard: NavItem[] = [
  { title: "Overview", url: "/dashboard", icon: LayoutDashboard },
  { title: "Live Dashboard", url: "/dashboard/live", icon: Activity },
];

// "Work" — day-to-day operational records
const work: NavItem[] = [
  { title: "Spray Jobs & Templates", url: "/spray-jobs", icon: Layers },
  { title: "Work Tasks", url: "/work-tasks", icon: ClipboardList },
  { title: "Field Trips", url: "/trips", icon: Sprout },
  { title: "Pins / Repairs / Observations", url: "/pins", icon: MapPin },
  { title: "Maintenance Logs", url: "/maintenance", icon: Wrench },
  { title: "Yields", url: "/yield", icon: Grape },
  { title: "Damage Records", url: "/damage-records", icon: AlertTriangle },
];

// "Equipment" — physical assets and fuel
const equipment: NavItem[] = [
  { title: "Tractors", url: "/setup/tractors", icon: Tractor },
  { title: "Spray Equipment", url: "/setup/spray-equipment", icon: Droplet },
  { title: "Vineyard Machines", url: "/setup/vineyard-machines", icon: Tractor },
  { title: "Other Equipment & Assets", url: "/setup/equipment-other", icon: Wrench },
  { title: "Fuel", url: "/fuel", icon: Fuel },
];

// "Reports" — exports & compliance
const reports: NavItem[] = [
  { title: "Cost Reports", url: "/reports/costs", icon: DollarSign },
  { title: "Trip Reports", url: "/reports/trips", icon: Route },
  { title: "Work Task Reports", url: "/reports/work-tasks", icon: ClipboardList },
  { title: "Spray Records", url: "/reports/spray", icon: FileBarChart },
  { title: "Rainfall Reports", url: "/reports/rainfall", icon: CloudRain },
  { title: "Growth Stage Records", url: "/reports/growth-stage", icon: Sprout },
  { title: "Documents & Exports", url: "/reports/documents", icon: FolderOpen },
];

// Owner/manager-only reports (non-financial)
const reportsAdmin: NavItem[] = [
  { title: "Data Coverage", url: "/reports/data-coverage", icon: Database },
];

// "Setup" — vineyard configuration
const setup: NavItem[] = [
  { title: "Team", url: "/team", icon: Users },
  { title: "Billing", url: "/billing", icon: DollarSign },
  { title: "Vineyard Settings", url: "/setup/vineyard", icon: Grape },
  { title: "Vineyard Location", url: "/setup/vineyard-location", icon: MapPin },
  { title: "Region & Units", url: "/setup/region-units", icon: Globe2 },
  { title: "Growing Season", url: "/setup/operational-preferences", icon: Sprout },
  { title: "Blocks", url: "/setup/paddocks", icon: Map },
  { title: "Grape Varieties", url: "/setup/grape-varieties", icon: Grape },
  { title: "Chemicals", url: "/setup/chemicals", icon: Beaker },
  { title: "Worker Types", url: "/setup/operator-categories", icon: UserCog },
  { title: "Saved Inputs", url: "/setup/saved-inputs", icon: Sprout },
  { title: "Weather Settings", url: "/setup/weather", icon: Cloud },
];

// "Tools" — calculators / helpers
const tools: NavItem[] = [
  { title: "Irrigation Advisor", url: "/tools/irrigation", icon: Droplet },
];

// System-admin-only tools (visibility gated in render).
const toolsSystemAdmin: NavItem[] = [
  { title: "Crop Health Maps", url: "/tools/satellite-mapping", icon: Satellite },
];




const systemAdmin: NavItem[] = [
  { title: "Admin Dashboard", url: "/admin/dashboard", icon: AdminDashIcon },
  { title: "User Activity", url: "/admin/user-activity", icon: Activity },
  { title: "Block Troubleshooter", url: "/admin/block-troubleshooter", icon: ShieldCheck },
  { title: "Support Requests", url: "/admin/support-requests", icon: LifeBuoy },
  { title: "System Admins", url: "/admin/system-admins", icon: ShieldCheck },
  { title: "Billing Grants", url: "/admin/billing-grants", icon: DollarSign },
  { title: "App Notices", url: "/admin/notices", icon: Bell },
  { title: "Feature Flags", url: "/admin/feature-flags", icon: Flag },
  { title: "Data Coverage", url: "/settings/data-coverage", icon: Database },
];


export function AppSidebar() {
  const { pathname } = useLocation();
  const [supportOpen, setSupportOpen] = useState(false);
  const { currentRole, memberships, selectedVineyardId } = useVineyard();
  const { isAdmin: isSystemAdmin } = useIsSystemAdmin();
  const { data: logoUrl } = useVineyardLogo();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;
  const isAdmin = currentRole === "owner" || currentRole === "manager";
  const { data: unresolvedSupport = 0 } = useUnresolvedSupportCount();
  const isActive = (p: string) => pathname === p;
  const visible = (items: NavItem[]) =>
    items.filter((i) => canAccessRoute(i.url, currentRole));
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const renderItems = (items: NavItem[]) =>
    items.map((item) => (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton
          asChild
          isActive={isActive(item.url)}
          className="rounded-lg text-[13px] font-medium text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-semibold data-[active=true]:shadow-[inset_2px_0_0_hsl(var(--sidebar-primary))] data-[active=true]:hover:bg-sidebar-accent data-[active=true]:hover:text-sidebar-accent-foreground [&_svg]:text-current"
        >
          <NavLink to={item.url} className="flex items-center gap-2.5">
            <item.icon className="h-4 w-4" />
            <span className="flex-1 truncate">{item.title}</span>
            {item.url === "/admin/support-requests" && unresolvedSupport > 0 && (
              <span className="ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white dark:bg-amber-400 dark:text-amber-950">
                {unresolvedSupport}
              </span>
            )}
            {item.url === "/tools/satellite-mapping" && (
              <span className="ml-auto rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                System Admin
              </span>
            )}
            {item.soon && (
              <span className="ml-auto rounded-sm bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                Soon
              </span>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  const renderGroup = (label: string, items: NavItem[], defaultOpen = true) => {
    if (items.length === 0) return null;
    const hasActive = items.some((i) => isActive(i.url));
    return (
      <Collapsible defaultOpen={defaultOpen || hasActive} className="group/collapsible">
        <SidebarGroup>
          <SidebarGroupLabel asChild>
            <CollapsibleTrigger className="flex w-full items-center justify-between text-[10.5px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/55 hover:text-sidebar-foreground">
              {label}
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=closed]/collapsible:-rotate-90" />
            </CollapsibleTrigger>
          </SidebarGroupLabel>
          <CollapsibleContent>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(items)}</SidebarMenu>
            </SidebarGroupContent>
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-3 border-b border-sidebar-border">
        {collapsed ? (
          <div className="flex justify-center">
            <BrandMark size={30} tile={false} alt="VineTrack" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 h-11">
              <BrandMark size={32} tile={false} alt="VineTrack" />
              <BrandName className="text-[18px] font-semibold" />
            </div>
            {vineyardName && (
              <div className="mt-2.5 pt-2.5 border-t border-sidebar-border flex items-center gap-2.5">
                <BrandMark circle logoUrl={logoUrl} size={28} alt={vineyardName} />
                <div className="flex flex-col leading-tight min-w-0">
                  <span className="text-[13px] font-semibold tracking-tight text-foreground truncate">
                    {vineyardName}
                  </span>
                  <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    Vineyard portal
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </SidebarHeader>
      <SidebarContent>
        {renderGroup("Dashboard", visible(dashboard))}
        {renderGroup("Work", visible(work))}
        {renderGroup("Equipment", visible(equipment), false)}
        {renderGroup("Tools", visible(isSystemAdmin ? [...tools, ...toolsSystemAdmin] : tools), false)}
        {renderGroup("Reports", visible(isAdmin ? [...reports, ...reportsAdmin] : reports), false)}
        {renderGroup("Setup", visible(setup), false)}
        {isSystemAdmin && renderGroup("System Admin", systemAdmin, false)}

      </SidebarContent>

      <SidebarFooter className="px-2 pb-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => setSupportOpen(true)}
              className="rounded-lg text-[13px] font-medium text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground [&_svg]:text-current"
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
