import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RefreshCw, Square, Trash2 } from "lucide-react";
import { fetchTripManagementSnapshot, mayDeleteConfirmedTrip, STALE_TRIP_END_BLOCKER, tripServerStatus, type TripManagementSnapshot } from "@/lib/tripManagement";

export default function ManageTrip({ vineyardId, tripId, userId, open, allowActions, busy, onDelete }: {
  vineyardId: string; tripId: string; userId: string | null; open: boolean;
  allowActions: boolean; busy: boolean; onDelete: (snapshot: TripManagementSnapshot) => void;
}) {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const query = useQuery({
    queryKey: ["trip-management", vineyardId, tripId, userId, open],
    enabled: open && online && !!userId,
    queryFn: () => {
      if (!userId) throw new Error("Sign in to verify Trip status.");
      return fetchTripManagementSnapshot(vineyardId, tripId, userId);
    },
    staleTime: 0, retry: false, refetchOnMount: "always", refetchOnWindowFocus: "always", refetchOnReconnect: "always", refetchInterval: open && online ? 30_000 : false,
  });
  const confirmed = open && online && query.isFetchedAfterMount && !query.isFetching && !query.isError ? query.data : undefined;
  const status = confirmed ? tripServerStatus(confirmed.trip) : null;
  const permitted = confirmed && ["owner", "manager", "supervisor"].includes(confirmed.role) && confirmed.canWrite;
  return <section aria-label="Manage Trip" className="rounded-md border bg-card p-3 space-y-3">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-semibold">Manage Trip</h3>
      <Button size="sm" variant="outline" disabled={!online || query.isFetching || busy || !userId} onClick={() => void query.refetch()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh status</Button>
    </div>
    <p role="status">{!online ? "Offline — current server status unavailable" : !userId ? "Sign in to verify status" : query.isError ? "Status unavailable — refresh to retry" : !confirmed ? "Checking current server status…" : `Server status: ${status === "inconsistent" ? "inconsistent — management blocked" : status}`}</p>
    {confirmed && <p className="text-xs text-muted-foreground">Vineyard role: {confirmed.role}{!confirmed.canWrite ? " · read-only access" : ""}</p>}
    <p className="text-muted-foreground">Active or paused Trips must be ended before they can be deleted. Trip age alone does not make ending safe.</p>
    {allowActions && <>
      {status !== "completed" && status !== "removed" && <div className="space-y-2">
        <Button size="sm" variant="outline" disabled><Square className="mr-1.5 h-3.5 w-3.5" />End stale Trip</Button>
        <p className="text-xs text-muted-foreground">{STALE_TRIP_END_BLOCKER}</p>
      </div>}
      {permitted && confirmed && <Button size="sm" variant="destructive" disabled={busy || !mayDeleteConfirmedTrip(confirmed)} onClick={() => onDelete(confirmed)}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete Trip</Button>}
      {status === "completed" && confirmed && !mayDeleteConfirmedTrip(confirmed) && <p className="text-xs text-muted-foreground">Deletion needs write permission, confirmed update version and no tank filling in progress.</p>}
    </>}
  </section>;
}