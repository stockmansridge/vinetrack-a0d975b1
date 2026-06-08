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
  { title: "Spray Equipment", url: "/setup/spray-equipment", icon: Gauge },
  { title: "Vineyard Machines", url: "/setup/vineyard-machines", icon: Tractor },
  { title: "Other Equipment & Assets", url: "/setup/equipment-other", icon: Wrench },
  { title: "Fuel", url: "/fuel", icon: Fuel },
];

// "Reports" — exports & compliance
const reports: NavItem[] = [
  { title: "Trip Reports", url: "/reports/trips", icon: Route },
  { title: "Spray Records", url: "/reports/spray", icon: FileBarChart },
  { title: "Rainfall Reports", url: "/reports/rainfall", icon: CloudRain },
  { title: "Growth Stage Records", url: "/reports/growth-stage", icon: Sprout },
  { title: "Documents & Exports", url: "/reports/documents", icon: FolderOpen },
];

// Owner/manager-only reports (financial)
const reportsAdmin: NavItem[] = [
  { title: "Cost Reports", url: "/reports/costs", icon: DollarSign },
];

// "Setup" — vineyard configuration
const setup: NavItem[] = [
  { title: "Team", url: "/team", icon: Users },
  { title: "Billing", url: "/billing", icon: DollarSign },
  { title: "Vineyard Settings", url: "/setup/vineyard", icon: Grape },
  { title: "Vineyard Location", url: "/setup/vineyard-location", icon: MapPin },
  { title: "Region & Units", url: "/setup/region-units", icon: Globe2 },
  { title: "Paddocks / Blocks", url: "/setup/paddocks", icon: Map },
  { title: "Grape Varieties", url: "/setup/grape-varieties", icon: Grape },
  { title: "Chemicals", url: "/setup/chemicals", icon: Beaker },
  { title: "Operator Categories", url: "/setup/operator-categories", icon: UserCog },
  { title: "Saved Inputs", url: "/setup/saved-inputs", icon: Sprout },
  { title: "Weather Settings", url: "/setup/weather", icon: Cloud },
];

// "Tools" — calculators / helpers
const tools: NavItem[] = [
  { title: "Irrigation Advisor", url: "/tools/irrigation", icon: Droplet },
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

  const renderItems = (items: NavItem[]) =>
    items.map((item) => (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton
          asChild
          isActive={isActive(item.url)}
          className="rounded-xl data-[active=true]:bg-accent data-[active=true]:text-primary data-[active=true]:font-bold data-[active=true]:hover:bg-accent data-[active=true]:hover:text-primary dark:data-[active=true]:text-sidebar-primary-foreground dark:data-[active=true]:hover:text-sidebar-primary-foreground hover:bg-[hsl(80_58%_46%/0.10)] hover:text-white"
        >
          <NavLink to={item.url} className="flex items-center gap-2">
            <item.icon className="h-4 w-4" />
            <span className="flex-1 truncate">{item.title}</span>
            {item.url === "/admin/support-requests" && unresolvedSupport > 0 && (
              <span className="ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white dark:bg-amber-400 dark:text-amber-950">
                {unresolvedSupport}
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
            <CollapsibleTrigger className="flex w-full items-center justify-between hover:text-sidebar-foreground">
              {label}
              <ChevronDown className="h-4 w-4 transition-transform group-data-[state=closed]/collapsible:-rotate-90" />
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
        {renderGroup("Dashboard", visible(dashboard))}
        {renderGroup("Work", visible(work))}
        {renderGroup("Equipment", visible(equipment), false)}
        {renderGroup("Tools", visible(tools))}
        {renderGroup("Reports", visible(isAdmin ? [...reports, ...reportsAdmin] : reports))}
        {renderGroup("Setup", visible(setup), false)}
        {isSystemAdmin && renderGroup("System Admin", systemAdmin, false)}

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
