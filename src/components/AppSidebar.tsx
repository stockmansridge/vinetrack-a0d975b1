import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Activity,
  Map,
  Tractor,
  Gauge,
  Users,
  FileText,
  Cloud,
  MapPin,
  Wrench,
  ClipboardList,
  Beaker,
  Layers,
  UserCog,
  Sprout,
  Settings,
  Database,
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

const dashboard = [
  { title: "Overview", url: "/dashboard", icon: LayoutDashboard },
  { title: "Live dashboard", url: "/dashboard/live", icon: Activity },
];

const operations = [
  { title: "Trips", url: "/trips", icon: Sprout },
  { title: "Spray records", url: "/spray-records", icon: FileText },
  { title: "Spray jobs & templates", url: "/spray-jobs", icon: Layers },
  { title: "Work tasks", url: "/work-tasks", icon: ClipboardList },
  { title: "Maintenance", url: "/maintenance", icon: Wrench },
  { title: "Pins / Repairs", url: "/pins", icon: MapPin },
  { title: "Yield reports", url: "/yield", icon: FileText },
];

const setup = [
  { title: "Team", url: "/team", icon: Users },
  { title: "Paddocks / Blocks", url: "/setup/paddocks", icon: Map },
  { title: "Tractors", url: "/setup/tractors", icon: Tractor },
  { title: "Spray equipment", url: "/setup/spray-equipment", icon: Gauge },
  { title: "Chemicals", url: "/setup/chemicals", icon: Beaker },
  { title: "Spray templates", url: "/setup/spray-presets", icon: Layers },
  { title: "Operator categories", url: "/setup/operator-categories", icon: UserCog },
  { title: "Weather settings", url: "/setup/weather", icon: Cloud },
];

const comingSoon: { title: string; url: string; icon: any }[] = [];

const settings = [
  { title: "Data coverage", url: "/settings/data-coverage", icon: Database },
];

export function AppSidebar() {
  const { pathname } = useLocation();
  const { currentRole, memberships, selectedVineyardId } = useVineyard();
  const { data: logoUrl } = useVineyardLogo();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;
  const isAdmin = currentRole === "owner" || currentRole === "manager";
  const isActive = (p: string) => pathname === p;

  const renderItems = (items: typeof dashboard) =>
    items.map((item) => (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton asChild isActive={isActive(item.url)}>
          <NavLink to={item.url} className="flex items-center gap-2">
            <item.icon className="h-4 w-4" />
            <span>{item.title}</span>
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-4">
        <div className="flex items-center gap-2">
          <BrandMark logoUrl={logoUrl} size={36} alt={vineyardName ?? "VineTrack"} />
          <div className="flex flex-col leading-tight min-w-0">
            <span className="font-semibold tracking-tight text-sidebar-foreground truncate">
              {vineyardName ?? "VineTrack"}
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
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(operations)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Setup &amp; Configuration</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(setup)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Reports &amp; Exports</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {renderItems([
                { title: "Overview", url: "/reports", icon: FileText },
                { title: "Spray reports", url: "/reports/spray", icon: FileText },
                { title: "Rainfall reports", url: "/reports/rainfall", icon: FileText },
                { title: "Documents & Exports", url: "/reports/documents", icon: FileText },
              ])}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {comingSoon.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Coming soon</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(comingSoon)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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
