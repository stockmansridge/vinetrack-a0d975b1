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
} from "@/components/ui/sidebar";
import { SupportRequestSheet } from "@/components/support/SupportRequestSheet";

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
  { title: "Fuel Purchases", url: "/fuel-purchases", icon: Fuel },
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
  { title: "Paddocks / Blocks", url: "/setup/paddocks", icon: Map },
  { title: "Tractors", url: "/setup/tractors", icon: Tractor },
  { title: "Spray Equipment", url: "/setup/spray-equipment", icon: Gauge },
  { title: "Other Equipment Items", url: "/setup/equipment-other", icon: Wrench },
  { title: "Chemicals", url: "/setup/chemicals", icon: Beaker },
  { title: "Operator Categories", url: "/setup/operator-categories", icon: UserCog },
  { title: "Saved Inputs", url: "/setup/saved-inputs", icon: Sprout },
  { title: "Weather Settings", url: "/setup/weather", icon: Cloud },
];

// "Tools" — calculators / helpers
const tools: NavItem[] = [
  { title: "Irrigation Advisor", url: "/tools/irrigation", icon: Droplet },
];




const settings: NavItem[] = [
  { title: "Data Coverage", url: "/settings/data-coverage", icon: Database },
];

const systemAdmin: NavItem[] = [
  { title: "Admin Dashboard", url: "/admin/dashboard", icon: AdminDashIcon },
  { title: "App Notices", url: "/admin/notices", icon: Bell },
  { title: "Feature Flags", url: "/admin/feature-flags", icon: Flag },
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
  const isActive = (p: string) => pathname === p;

  const renderItems = (items: NavItem[]) =>
    items.map((item) => (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton
          asChild
          isActive={isActive(item.url)}
          className="rounded-xl data-[active=true]:bg-accent data-[active=true]:text-primary data-[active=true]:font-bold data-[active=true]:hover:bg-accent data-[active=true]:hover:text-primary hover:bg-[hsl(80_58%_46%/0.10)] hover:text-white"
        >
          <NavLink to={item.url} className="flex items-center gap-2">
            <item.icon className="h-4 w-4" />
            <span className="flex-1 truncate">{item.title}</span>
            {item.soon && (
              <span className="ml-auto rounded-sm bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                Soon
              </span>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

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
        <SidebarGroup>
          <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(dashboard)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Work</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(work)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Reports</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(isAdmin ? [...reports, ...reportsAdmin] : reports)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Setup</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(setup)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(tools)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Settings</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(settings)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {isSystemAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>System Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(systemAdmin)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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
