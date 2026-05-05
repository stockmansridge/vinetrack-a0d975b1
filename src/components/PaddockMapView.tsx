import { useEffect, useState } from "react";
import AppleMapPaddockMap from "@/components/AppleMapPaddockMap";
import PaddockMap from "@/components/PaddockMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { initMapKit } from "@/lib/mapkit";

type Status = "checking" | "apple" | "fallback";
type Forced = "auto" | "apple" | "osm";

export default function PaddockMapView() {
  const [status, setStatus] = useState<Status>("checking");
  const [reason, setReason] = useState<string | null>(null);
  const [forced, setForced] = useState<Forced>("auto");

  useEffect(() => {
    if (forced === "osm") {
      setStatus("fallback");
      return;
    }
    let cancelled = false;
    setStatus("checking");
    initMapKit()
      .then(() => {
        if (!cancelled) setStatus("apple");
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setReason(e?.message || "unknown");
          setStatus(forced === "apple" ? "checking" : "fallback");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [forced]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <div className="inline-flex rounded-md border bg-background p-0.5">
          {(["auto", "apple", "osm"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={forced === f ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => setForced(f)}
            >
              {f === "auto" ? "Auto" : f === "apple" ? "Apple" : "OSM"}
            </Button>
          ))}
        </div>
        {status === "checking" && (
          <Badge variant="outline" className="text-xs">Map: checking…</Badge>
        )}
        {status === "fallback" && reason && forced !== "osm" && (
          <Badge variant="outline" className="text-xs" title={reason}>
            Apple Maps unavailable — using fallback
          </Badge>
        )}
      </div>
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
