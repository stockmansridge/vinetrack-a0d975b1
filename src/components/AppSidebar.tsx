import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
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

const main = [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard }];

const setup = [
  { title: "Paddocks", url: "/setup/paddocks", icon: Map },
  { title: "Tractors", url: "/setup/tractors", icon: Tractor },
  { title: "Spray equipment", url: "/setup/spray-equipment", icon: Gauge },
];

const records = [
  { title: "Pins", url: "/pins", icon: MapPin },
  { title: "Spray records", url: "/spray-records", icon: FileText },
  { title: "Work tasks", url: "/work-tasks", icon: ClipboardList },
];

const team = [{ title: "Team", url: "/team", icon: Users }];

const comingSoon = [
  { title: "Saved chemicals", url: "/soon/chemicals", icon: Beaker },
  { title: "Spray presets", url: "/soon/spray-presets", icon: Layers },
  { title: "Operator categories", url: "/soon/operator-categories", icon: UserCog },
  { title: "Weather", url: "/soon/weather", icon: Cloud },
  { title: "Trips", url: "/soon/trips", icon: Sprout },
  { title: "Maintenance", url: "/soon/maintenance", icon: Wrench },
  { title: "Yield reports", url: "/soon/yield", icon: FileText },
];

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

  const renderItems = (items: typeof main) =>
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
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(main)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Setup</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(setup)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Records</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(records)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Team</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(team)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Coming soon</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(comingSoon)}</SidebarMenu>
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
