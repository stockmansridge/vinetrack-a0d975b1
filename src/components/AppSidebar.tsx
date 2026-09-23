import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { BrandName } from "@/components/BrandName";
import { ChevronDown, LifeBuoy, Lightbulb, ShieldCheck, Settings2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useVineyard } from "@/context/VineyardContext";
import { useIsSystemAdmin, useIsSystemAdminRaw } from "@/lib/systemAdmin";
import { useDemoMode } from "@/context/DemoModeContext";
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
import { useNavViewer } from "@/hooks/useNavViewer";
import {
  ACTIVITIES,
  SYSTEM_ADMIN_DASHBOARD,
  SYSTEM_ADMIN_GROUPS,
  accessibleViews,
  defaultPathFor,
  resolveLocation,
  systemAdminItemMatchesPath,
  type NavActivity,
  type NavGroup,
  type SystemAdminGroup,
  type SystemAdminItem,
} from "@/lib/navigationConfig";

const CUSTOMER_GROUPS: NavGroup[] = ["Overview", "Vineyard", "Work", "Resources"];

function SystemAdminNavGroup({
  group,
  pathname,
  renderItem,
}: {
  group: SystemAdminGroup;
  pathname: string;
  renderItem: (item: SystemAdminItem) => React.ReactNode;
}) {
  const active = group.items.some((item) => systemAdminItemMatchesPath(item, pathname));
  const [open, setOpen] = useState(active);

  useEffect(() => {
    if (active) setOpen(true);
  }, [active, pathname]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/admin-nav">
      <SidebarGroup className="py-0.5">
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger className="flex w-full items-center justify-between text-[10px] font-medium uppercase tracking-[0.08em] text-sidebar-foreground/50 hover:text-sidebar-foreground/75">
            {group.label}
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=closed]/admin-nav:-rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>{group.items.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function AppSidebar() {
  const { pathname } = useLocation();
  const [supportOpen, setSupportOpen] = useState(false);
  const { memberships, selectedVineyardId } = useVineyard();
  const { isAdmin: isSystemAdmin } = useIsSystemAdmin();
  const { isAdmin: isSystemAdminRaw } = useIsSystemAdminRaw();
  const { demoMode } = useDemoMode();
  const highlightAdminItems = isSystemAdminRaw && !demoMode;
  const { data: logoUrl } = useVineyardLogo();
  const viewer = useNavViewer();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;
  const { data: unresolvedSupport = 0 } = useUnresolvedSupportCount();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const active = resolveLocation(pathname);

  const buttonClass = (isActive: boolean, admin = false) =>
    `rounded-lg text-[13px] font-medium hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-semibold data-[active=true]:shadow-[inset_2px_0_0_hsl(var(--sidebar-primary))] [&_svg]:text-current ${
      admin && highlightAdminItems ? "text-amber-600 dark:text-amber-400" : "text-sidebar-foreground"
    }${isActive ? "" : ""}`;

  const renderActivity = (activity: NavActivity) => {
    const views = accessibleViews(activity, viewer);
    if (views.length === 0) return null;
    const target = defaultPathFor(activity, viewer);
    if (!target) return null;
    const isActive = active.activity?.id === activity.id;
    const Icon = activity.icon;
    return (
      <SidebarMenuItem key={activity.id}>
        <SidebarMenuButton asChild isActive={isActive} tooltip={activity.label} className={buttonClass(isActive)}>
          <NavLink to={target} className="flex items-center gap-2.5">
            <Icon className="h-4 w-4" />
            <span className="flex-1 truncate">{activity.label}</span>
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  const renderGroup = (label: NavGroup) => {
    const items = ACTIVITIES.filter((a) => a.group === label)
      .map(renderActivity)
      .filter(Boolean);
    if (items.length === 0) return null;
    return (
      <SidebarGroup key={label}>
        <SidebarGroupLabel className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/55">
          {label}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>{items}</SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  const settingsActivity = ACTIVITIES.find((a) => a.id === "settings")!;
  const settingsTarget = defaultPathFor(settingsActivity, viewer);
  const settingsActive = active.activity?.id === "settings";

  const renderSystemAdminItem = (item: SystemAdminItem) => {
    const Icon = item.icon ?? ShieldCheck;
    const isActive = systemAdminItemMatchesPath(item, pathname);
    return (
      <SidebarMenuItem key={item.path}>
        <SidebarMenuButton
          asChild
          isActive={isActive}
          tooltip={item.label}
          className={buttonClass(isActive, true)}
        >
          <NavLink to={item.path} className="flex items-center gap-2.5">
            <Icon className="h-4 w-4" />
            <span className="flex-1 truncate">{item.label}</span>
            {item.path === "/admin/support-requests" && unresolvedSupport > 0 && (
              <span className="ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white dark:bg-amber-400 dark:text-amber-950">
                {unresolvedSupport}
              </span>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
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
        {CUSTOMER_GROUPS.map(renderGroup)}

        {isSystemAdmin && (
          <SidebarGroup className="gap-1">
            <SidebarGroupLabel className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-amber-600 dark:text-amber-400">
              System Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderSystemAdminItem(SYSTEM_ADMIN_DASHBOARD)}</SidebarMenu>
            </SidebarGroupContent>
            {SYSTEM_ADMIN_GROUPS.map((group) => (
              <SystemAdminNavGroup
                key={group.label}
                group={group}
                pathname={pathname}
                renderItem={renderSystemAdminItem}
              />
            ))}
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="px-2 pb-3">
        <SidebarMenu>
          {settingsTarget && (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={settingsActive}
                tooltip="Vineyard Settings"
                className={buttonClass(settingsActive)}
              >
                <NavLink to={settingsTarget} className="flex items-center gap-2.5">
                  <Settings2 className="h-4 w-4" />
                  <span>Vineyard Settings</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === "/feature-requests"}
              tooltip="Feature Requests"
              className={buttonClass(pathname === "/feature-requests")}
            >
              <NavLink to="/feature-requests" className="flex items-center gap-2.5">
                <Lightbulb className="h-4 w-4" />
                <span>Feature Requests</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => setSupportOpen(true)}
              tooltip="Contact support"
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
