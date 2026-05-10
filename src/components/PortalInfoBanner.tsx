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
    <div className="relative mx-4 mt-3 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-soft-sm">
      <div className="flex items-center gap-3 pr-9">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary">
          <Info className="h-4 w-4 text-primary" aria-hidden="true" />
        </span>
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">
            Welcome to the <BrandName /> Admin Portal.
          </span>{" "}
          Use the iOS app to record vineyard work; use this portal to review,
          export and plan. Pins and trips are completed from the iOS app.
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-1.5 top-1.5 h-6 w-6 rounded-full"
        onClick={handleDismiss}
        aria-label="Dismiss information banner"
        title="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
