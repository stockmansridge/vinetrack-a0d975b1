import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Map,
  Tractor,
  SprayCan,
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
} from "lucide-react";
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
  { title: "Spray equipment", url: "/setup/spray-equipment", icon: SprayCan },
];

const team = [{ title: "Team", url: "/team", icon: Users }];

const comingSoon = [
  { title: "Saved chemicals", url: "/soon/chemicals", icon: Beaker },
  { title: "Spray presets", url: "/soon/spray-presets", icon: Layers },
  { title: "Operator categories", url: "/soon/operator-categories", icon: UserCog },
  { title: "Weather", url: "/soon/weather", icon: Cloud },
  { title: "Pins", url: "/soon/pins", icon: MapPin },
  { title: "Trips", url: "/soon/trips", icon: Sprout },
  { title: "Spray records", url: "/soon/spray-records", icon: FileText },
  { title: "Work tasks", url: "/soon/work-tasks", icon: ClipboardList },
  { title: "Maintenance", url: "/soon/maintenance", icon: Wrench },
  { title: "Yield reports", url: "/soon/yield", icon: FileText },
];

export function AppSidebar() {
  const { pathname } = useLocation();
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
      <SidebarHeader className="px-4 py-3">
        <span className="font-semibold tracking-tight">VineTrack</span>
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
      </SidebarContent>
    </Sidebar>
  );
}
