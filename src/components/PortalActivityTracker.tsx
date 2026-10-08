import { useEffect, useRef } from "react";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import {
  HEARTBEAT_MS,
  buildActivityPayload,
  getOrCreateClientInstanceId,
} from "@/lib/portalClientActivity";

/**
 * Records Portal activity for the signed-in user on sign-in / session restore,
 * when the tab becomes visible again, and about every 15 minutes while visible.
 * Renders nothing; errors are swallowed so telemetry never affects the UI.
 */
export function PortalActivityTracker() {
  const { user } = useAuth();
  const { selectedVineyardId } = useVineyard();
  const vineyardRef = useRef<string | null>(selectedVineyardId);
  vineyardRef.current = selectedVineyardId;
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let lastSent = 0;
    let inFlight = false;

    const send = async (force = false) => {
      if (cancelled || inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (!force && Date.now() - lastSent < HEARTBEAT_MS - 5000) return;
      inFlight = true;
      try {
        const id = getOrCreateClientInstanceId(
          typeof localStorage !== "undefined" ? localStorage : null,
        );
        const payload = buildActivityPayload(id, navigator.userAgent, vineyardRef.current);
        const { error } = await (iosSupabase as any).rpc("record_my_client_activity", payload);
        if (!error) lastSent = Date.now();
        else console.debug("[portal-activity] not recorded:", error.message);
      } catch (e) {
        console.debug("[portal-activity] not recorded:", e);
      } finally {
        inFlight = false;
      }
    };

    void send(true);
    const timer = window.setInterval(() => void send(), HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void send();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);

  return null;
}
