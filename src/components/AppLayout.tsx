import { Outlet } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { PendingInvitesBanner } from "@/components/invites/PendingInvitesModal";
import PortalInfoBanner from "@/components/PortalInfoBanner";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown } from "lucide-react";
import { BrandName } from "@/components/BrandName";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SupportAlertPill } from "@/components/support/SupportAlertPill";
import { useCurrentProfile, displayNameFor } from "@/hooks/useCurrentProfile";
import { ProfileDialog } from "@/components/ProfileDialog";
import { GlobalSearch } from "@/components/GlobalSearch";
import { useState } from "react";
import vineyardBg from "@/assets/vineyard-bg.webp.asset.json";

export default function AppLayout() {
  const { memberships, selectedVineyardId, selectVineyard, currentRole } = useVineyard();
  const { user, signOut } = useAuth();
  const { profile } = useCurrentProfile();
  const [profileOpen, setProfileOpen] = useState(false);
  const displayName = displayNameFor(profile, user?.email);


  return (
    <SidebarProvider>
      <Helmet>
        <title>VineTrack portal — vineyard operations</title>
        <meta
          name="description"
          content="Manage blocks, spray records, work tasks, maintenance and your team inside the VineTrack vineyard portal."
        />
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-30 h-16 flex items-center gap-3 border-b border-border bg-card/90 backdrop-blur px-4 md:px-6">
            <SidebarTrigger />
            <div className="flex items-center gap-2">
              <Select value={selectedVineyardId ?? undefined} onValueChange={selectVineyard}>
                <SelectTrigger className="w-[220px] rounded-lg">
                  <SelectValue placeholder="Select vineyard" />
                </SelectTrigger>
                <SelectContent>
                  {memberships.map((m) => (
                    <SelectItem key={m.vineyard_id} value={m.vineyard_id}>
                      {m.vineyard_name ?? m.vineyard_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {currentRole && (
                <Badge
                  variant="secondary"
                  className="capitalize rounded-full bg-secondary text-secondary-foreground border border-border/60 px-2.5 py-0.5 font-medium"
                >
                  {currentRole}
                </Badge>
              )}
            </div>
            <div className="hidden lg:flex items-center flex-1 justify-center px-6">
              <GlobalSearch />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <SupportAlertPill />
              <ThemeToggle />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5 rounded-full">
                    <span className="hidden sm:inline text-sm">{displayName}</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setProfileOpen(true)}>
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => signOut()}>Sign out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />

            </div>
          </header>
          <PortalInfoBanner />
          <PendingInvitesBanner />
          <main className="relative flex-1 p-4 md:p-6 lg:p-8 bg-background min-w-0 w-full max-w-full overflow-x-hidden">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-[360px] bg-no-repeat bg-right-top opacity-[0.12] dark:hidden"
              style={{
                backgroundImage: `url(${vineyardBg.url})`,
                backgroundSize: "min(900px, 65vw) auto",
                WebkitMaskImage:
                  "linear-gradient(to bottom left, rgba(0,0,0,0.9), rgba(0,0,0,0.3) 55%, transparent 85%)",
                maskImage:
                  "linear-gradient(to bottom left, rgba(0,0,0,0.9), rgba(0,0,0,0.3) 55%, transparent 85%)",
              }}
            />
            <div className="relative">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
