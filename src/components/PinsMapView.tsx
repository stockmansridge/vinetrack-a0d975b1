import { useEffect, useState } from "react";
import ApplePinsMap from "@/components/ApplePinsMap";
import { Badge } from "@/components/ui/badge";
import { initMapKit } from "@/lib/mapkit";

export type PinStatusFilter = "active" | "completed" | "all";

export default function PinsMapView({
  statusFilter = "active",
  hideGrowthStages = false,
}: { statusFilter?: PinStatusFilter; hideGrowthStages?: boolean } = {}) {
  const [status, setStatus] = useState<"checking" | "apple" | "error">("checking");
  const [reason, setReason] = useState<string | null>(null);

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
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">Map provider: Apple Maps</div>
        {status === "checking" && <Badge variant="outline" className="text-xs">Loading map…</Badge>}
      </div>
      {status === "apple" ? (
        <ApplePinsMap
          statusFilter={statusFilter}
          hideGrowthStages={hideGrowthStages}
          onUnavailable={(r) => {
            setReason(r);
            setStatus("error");
          }}
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
