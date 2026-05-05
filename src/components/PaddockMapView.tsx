import { useEffect, useState } from "react";
import AppleMapPaddockMap from "@/components/AppleMapPaddockMap";
import PaddockMap from "@/components/PaddockMap";
import { Badge } from "@/components/ui/badge";
import { initMapKit } from "@/lib/mapkit";

type Status = "checking" | "apple" | "fallback";

export default function PaddockMapView() {
  const [status, setStatus] = useState<Status>("checking");
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    initMapKit()
      .then(() => {
        if (!cancelled) setStatus("apple");
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setReason(e?.message || "unknown");
          setStatus("fallback");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-3">
      {status === "checking" && (
        <div className="flex items-center justify-end">
          <Badge variant="outline" className="text-xs">Map: checking…</Badge>
        </div>
      )}
      {status === "fallback" && reason && (
        <div className="flex items-center justify-end">
          <Badge variant="outline" className="text-xs" title={reason}>
            Apple Maps unavailable — using fallback
          </Badge>
        </div>
      )}
      {status === "apple" ? (
        <AppleMapPaddockMap
          onUnavailable={(r) => {
            setReason(r);
            setStatus("fallback");
          }}
        />
      ) : status === "fallback" ? (
        <PaddockMap />
      ) : (
        <div className="h-[600px] rounded-md bg-muted animate-pulse" />
      )}
    </div>
  );
}
