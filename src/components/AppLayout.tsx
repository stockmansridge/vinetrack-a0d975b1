import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
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
        <div className="flex-1 flex flex-col">
          <header className="h-14 flex items-center gap-3 border-b px-3">
            <SidebarTrigger />
            <div className="flex items-center gap-2">
              <Select value={selectedVineyardId ?? undefined} onValueChange={selectVineyard}>
                <SelectTrigger className="w-[240px]">
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
              {currentRole && <Badge variant="secondary">{currentRole}</Badge>}
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span
                className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                title="This portal is connected to the production database but cannot modify data."
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
                Read-only portal — production data
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1">
                    {user?.email} <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => signOut()}>Sign out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="flex-1 p-6 bg-muted/20">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
