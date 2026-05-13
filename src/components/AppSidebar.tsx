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
} from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
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
} from "@/components/ui/sidebar";

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
  { title: "Yield", url: "/yield", icon: Grape },
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

// "Setup" — vineyard configuration
const setup: NavItem[] = [
  { title: "Team", url: "/team", icon: Users },
  { title: "Paddocks / Blocks", url: "/setup/paddocks", icon: Map },
  { title: "Tractors", url: "/setup/tractors", icon: Tractor },
  { title: "Spray Equipment", url: "/setup/spray-equipment", icon: Gauge },
  { title: "Other Equipment Items", url: "/setup/equipment-other", icon: Wrench },
  { title: "Chemicals", url: "/setup/chemicals", icon: Beaker },
  { title: "Operator Categories", url: "/setup/operator-categories", icon: UserCog },
  { title: "Weather Settings", url: "/setup/weather", icon: Cloud },
];

// "Tools" — calculators / helpers
const tools: NavItem[] = [
  { title: "Irrigation Advisor", url: "/tools/irrigation", icon: Droplet },
];

// iOS-synced data views
const iosData: NavItem[] = [
  { title: "Fuel Purchases", url: "/soon/fuel-purchases", icon: Fuel, soon: true },
];

const settings: NavItem[] = [
  { title: "Data Coverage", url: "/settings/data-coverage", icon: Database },
];

export function AppSidebar() {
  const { pathname } = useLocation();
  const { currentRole, memberships, selectedVineyardId } = useVineyard();
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
            <SidebarMenu>{renderItems(reports)}</SidebarMenu>
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
        <SidebarGroup>
          <SidebarGroupLabel>iOS Data (Coming Soon)</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(iosData)}</SidebarMenu>
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
      </SidebarContent>
    </Sidebar>
  );
}
