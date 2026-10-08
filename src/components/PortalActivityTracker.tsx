import { useEffect, useRef } from "react";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import {
  HEARTBEAT_MS,
  buildActivityPayload,
  getOrCreateClientInstanceId,
  safeLocalStorage,
} from "@/lib/portalClientActivity";

/**
 * Records Portal activity for the signed-in user: immediately on sign-in or
 * session restore, again when a vineyard is first selected / changed, when the
 * tab becomes visible, and about every 15 minutes while visible.
 * Renders nothing; errors are swallowed so telemetry never affects the UI.
 */
export function PortalActivityTracker() {
  const { user } = useAuth();
  const { selectedVineyardId } = useVineyard();
  const vineyardRef = useRef<string | null>(selectedVineyardId);
  vineyardRef.current = selectedVineyardId;
  const sendRef = useRef<((force?: boolean) => Promise<void>) | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let lastSent = 0;
    let inFlight = false;

    const send = async (force = false) => {
      if (cancelled || inFlight) return;
      if (!force && document.visibilityState === "hidden") return;
      if (!force && Date.now() - lastSent < HEARTBEAT_MS - 5000) return;
      inFlight = true;
      try {
        const id = getOrCreateClientInstanceId(safeLocalStorage());
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
    sendRef.current = send;

    void send(true);
    const timer = window.setInterval(() => void send(), HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void send();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      sendRef.current = null;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);

  // Vineyard became known/changed: record it promptly (not throttled).
  useEffect(() => {
    if (userId && selectedVineyardId) void sendRef.current?.(true);
  }, [userId, selectedVineyardId]);

  return null;
}
