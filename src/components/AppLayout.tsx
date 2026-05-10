import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
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

export default function AppLayout() {
  const { memberships, selectedVineyardId, selectVineyard, currentRole } = useVineyard();
  const { user, signOut } = useAuth();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b bg-card/80 backdrop-blur px-4">
            <SidebarTrigger />
            <div className="flex items-center gap-2">
              <Select value={selectedVineyardId ?? undefined} onValueChange={selectVineyard}>
                <SelectTrigger className="w-[240px] rounded-lg">
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
                <Badge variant="secondary" className="capitalize">
                  {currentRole}
                </Badge>
              )}
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span
                className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning-foreground/90"
                title="Production database — only tractor & spray equipment setup edits are enabled."
              >
                <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
                Production portal
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1 rounded-full">
                    <span className="hidden sm:inline">{user?.email}</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => signOut()}>Sign out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <PortalInfoBanner />
          <main className="flex-1 p-6 bg-background min-w-0 w-full max-w-full overflow-x-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
