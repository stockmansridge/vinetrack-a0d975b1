// Right-hand drawer that overlays the map workspace. Hosts Details, History
// and (admin-only) Admin tab panels. Rendered inside the map container so it
// never covers the VineTrack application header. Preserves MapKit viewport
// because opening/closing this drawer does not remount `<SatelliteMap />`.
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type DrawerTab = "details" | "history" | "admin";

export default function MapWorkspaceDrawer({
  open,
  tab,
  onTabChange,
  onClose,
  isSystemAdmin,
  details,
  history,
  admin,
}: {
  open: boolean;
  tab: DrawerTab;
  onTabChange: (t: DrawerTab) => void;
  onClose: () => void;
  isSystemAdmin: boolean;
  details: ReactNode;
  history: ReactNode;
  admin: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Escape closes the drawer first (page also has a focus handler for map-focus).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-label="Crop health workspace details"
      className="absolute inset-y-0 right-0 z-[580] w-full sm:w-[420px] max-w-[calc(100%-1rem)] bg-background/98 border-l shadow-xl backdrop-blur flex flex-col animate-in slide-in-from-right duration-200"
    >
      <Tabs value={tab} onValueChange={(v) => onTabChange(v as DrawerTab)} className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-2 pt-2 pb-1 border-b">
          <TabsList className="h-8">
            <TabsTrigger value="details" className="text-xs px-2 h-7">Details</TabsTrigger>
            <TabsTrigger value="history" className="text-xs px-2 h-7">History</TabsTrigger>
            {isSystemAdmin && (
              <TabsTrigger value="admin" className="text-xs px-2 h-7">Admin</TabsTrigger>
            )}
          </TabsList>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
            aria-label="Close workspace panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <TabsContent value="details" className="flex-1 overflow-y-auto p-3 mt-0 focus-visible:outline-none">
          {details}
        </TabsContent>
        <TabsContent value="history" className="flex-1 overflow-y-auto p-3 mt-0 focus-visible:outline-none">
          {history}
        </TabsContent>
        {isSystemAdmin && (
          <TabsContent value="admin" className="flex-1 overflow-y-auto p-3 mt-0 focus-visible:outline-none">
            {admin}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
