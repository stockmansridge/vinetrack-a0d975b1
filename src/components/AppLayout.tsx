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
import { BrandName } from "@/components/BrandName";

export default function AppLayout() {
  const { memberships, selectedVineyardId, selectVineyard, currentRole } = useVineyard();
  const { user, signOut } = useAuth();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="relative h-14 flex items-center gap-3 border-b bg-card/80 backdrop-blur px-4">
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
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2">
              <span className="text-base">
                <BrandName />
              </span>
            </div>
            <div className="ml-auto flex items-center gap-3">
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
