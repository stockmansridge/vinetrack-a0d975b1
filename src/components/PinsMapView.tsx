import { useCallback, useEffect, useState } from "react";
import type { PermanentItem } from '@/lib/permanentItems';
import ApplePinsMap from "@/components/ApplePinsMap";
import { Badge } from "@/components/ui/badge";
import { initMapKit } from "@/lib/mapkit";

export type PinStatusFilter = "active" | "completed" | "all";

export default function PinsMapView({
  statusFilter = "active",
  hideGrowthStages = false,
  showPermanentItems = false,
  onPermanentItemSelect,
}: { statusFilter?: PinStatusFilter; hideGrowthStages?: boolean; showPermanentItems?: boolean; onPermanentItemSelect?: (item: PermanentItem) => void } = {}) {
  const [status, setStatus] = useState<"checking" | "apple" | "error">("checking");
  const [reason, setReason] = useState<string | null>(null);
  const onUnavailable = useCallback((r: string) => { setReason(r); setStatus('error'); }, []);

  useEffect(() => {
    let cancelled = false;
    initMapKit()
      .then(() => !cancelled && setStatus("apple"))
      .catch((e: Error) => {
        if (cancelled) return;
        setReason(e?.message || "unknown");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-3">
      {status === "checking" && (
        <div className="flex justify-end">
          <Badge variant="outline" className="text-xs">Loading map…</Badge>
        </div>
      )}
      {status === "apple" ? (
        <ApplePinsMap
          statusFilter={statusFilter}
          hideGrowthStages={hideGrowthStages}
          showPermanentItems={showPermanentItems}
          onPermanentItemSelect={onPermanentItemSelect}
          onUnavailable={onUnavailable}
        />
      ) : status === "error" ? (
        <div className="h-[600px] rounded-md border flex items-center justify-center text-sm text-muted-foreground p-4 text-center" title={reason ?? undefined}>
          Apple Maps couldn't load right now. Please refresh to try again.
        </div>
      ) : (
        <div className="h-[600px] rounded-md bg-muted animate-pulse" />
      )}
    </div>
  );
}
