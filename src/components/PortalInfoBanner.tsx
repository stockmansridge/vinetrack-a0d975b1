import { useState, useEffect } from "react";
import { X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandName } from "@/components/BrandName";

const STORAGE_KEY = "vt_portal_info_banner_dismissed";

export default function PortalInfoBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (dismissed !== "true") {
      setVisible(true);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="relative border-b bg-primary/5 px-4 py-3">
      <div className="flex items-start gap-3 pr-10">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            Welcome to the <BrandName /> Admin Portal
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            VineTrack combines an in-field iOS app with this administrator portal.
            Use the iOS app to record work in the vineyard. Use this portal to review
            completed work, export reports, manage setup data, and plan upcoming jobs.
            Pins and trips are completed from the iOS app, not closed from the portal.
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-7 w-7 rounded-full"
        onClick={handleDismiss}
        aria-label="Dismiss information banner"
        title="Dismiss"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
