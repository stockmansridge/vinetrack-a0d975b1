import { useCallback, useEffect, useState } from "react";
import AppleMapPaddockMap from "@/components/AppleMapPaddockMap";
import { initMapKit } from "@/lib/mapkit";

type Status = "checking" | "apple" | "unavailable";

export default function PaddockMapView() {
  const [status, setStatus] = useState<Status>("checking");
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("checking");
    initMapKit()
      .then(() => {
        if (!cancelled) setStatus("apple");
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setReason(e?.message || "unknown");
          setStatus("unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUnavailable = useCallback((message: string) => {
    setReason(message);
    setStatus("unavailable");
  }, []);

  return (
    <div>
      {status === "apple" ? (
        <AppleMapPaddockMap onUnavailable={handleUnavailable} />
      ) : status === "unavailable" ? (
        <div className="flex h-[600px] items-center justify-center rounded-md border bg-muted/30 px-6 text-center text-sm text-muted-foreground">
          Apple Maps is unavailable{reason ? `: ${reason}` : "."}
        </div>
      ) : (
        <div className="h-[600px] rounded-md bg-muted animate-pulse" />
      )}
    </div>
  );
}
