import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, Loader2, ShieldAlert } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { PageHead } from "@/components/PageHead";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatDateTime } from "@/lib/dateFormat";
import {
  checkInsightsAccess,
  fetchCanonicalGrowthRecordIds,
  fetchScoutVisitDetail,
  isPermissionError,
  locationLabel,
  measuredCoord,
  signScoutPhotoUrl,
  stopCoord,
  stopLabel,
  stopTime,
  stopWeather,
  type ScoutObservation,
} from "@/lib/scoutReports";
import {
  buildScoutReportPdf,
  loadScoutReportBranding,
  scoutReportFilename,
  type ScoutPdfModel,
} from "@/lib/scoutReportPdf";
import ScoutStopsMap, { type ScoutMapMarker } from "@/components/scout/ScoutStopsMap";
import { supabase } from "@/integrations/ios-supabase/client";
import { parsePolygonPoints } from "@/lib/paddockGeometry";

function WeatherCard({ title, snapshot }: { title: string; snapshot: Record<string, unknown> | null }) {
  const entries = snapshot
    ? Object.entries(snapshot).filter(
        ([, v]) => v != null && (typeof v !== "object" || Array.isArray(v)),
      )
    : [];
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs">
      <div className="mb-1 font-medium text-foreground">{title}</div>
      {!snapshot ? (
        <div className="text-muted-foreground">Weather snapshot not recorded.</div>
      ) : entries.length === 0 ? (
        <div className="text-muted-foreground">Weather snapshot recorded but empty.</div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          {entries.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-foreground">{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function ObservationPhoto({ storagePath, caption }: { storagePath: string; caption: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    signScoutPhotoUrl(storagePath).then((u) => {
      if (!live) return;
      if (u) setUrl(u);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [storagePath]);

  if (failed) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        Photo not available (missing or not yet synced). {caption}
      </div>
    );
  }
  if (!url) {
    return (
      <div className="flex h-24 items-center justify-center rounded-md border bg-muted/30 text-xs text-muted-foreground">
        Loading photo…
      </div>
    );
  }
  return (
    <figure className="space-y-1">
      <img src={url} alt={caption} className="max-h-64 rounded-md border object-contain" />
      <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

export default function ScoutReportDetailPage() {
  const { visitId } = useParams<{ visitId: string }>();
  const { selectedVineyardId, memberships } = useVineyard();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  // Access preflight — RLS hides rows silently, so confirm access first.
  const accessQuery = useQuery({
    queryKey: ["insights-access", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => checkInsightsAccess(selectedVineyardId!),
  });
  const access = accessQuery.data;

  const detailQuery = useQuery({
    queryKey: ["scout-visit-detail", selectedVineyardId, visitId],
    enabled: !!selectedVineyardId && !!visitId && access === "allowed",
    queryFn: () => fetchScoutVisitDetail(selectedVineyardId!, visitId!),
  });
  const detail = detailQuery.data;

  const linkedGrowthIds = useMemo(() => {
    if (!detail) return [] as string[];
    const ids: string[] = [];
    for (const list of detail.observationsByAssessment.values()) {
      for (const o of list) if (o.linked_growth_record_id) ids.push(o.linked_growth_record_id);
    }
    return ids;
  }, [detail]);

  const canonicalGrowthQuery = useQuery({
    queryKey: ["scout-growth-verify", selectedVineyardId, linkedGrowthIds.join("|")],
    enabled: linkedGrowthIds.length > 0,
    queryFn: () => fetchCanonicalGrowthRecordIds(linkedGrowthIds),
  });
  const canonicalGrowthIds = canonicalGrowthQuery.data ?? new Set<string>();

  // Linked evidence locations: vineyard pins and verified canonical E-L
  // records. These are provenance markers, distinct from measured GPS.
  const linkedPinIds = useMemo(() => {
    if (!detail) return [] as string[];
    const ids: string[] = [];
    for (const list of detail.observationsByAssessment.values()) {
      for (const o of list) if (o.linked_pin_id) ids.push(o.linked_pin_id);
    }
    return Array.from(new Set(ids));
  }, [detail]);

  const linkedPinsQuery = useQuery({
    queryKey: ["scout-linked-pins", selectedVineyardId, linkedPinIds.join("|")],
    enabled: linkedPinIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pins")
        .select("id, title, latitude, longitude")
        .in("id", linkedPinIds)
        .is("deleted_at", null);
      if (error) {
        if (isPermissionError(error)) return [] as { id: string; title: string | null; latitude: number | null; longitude: number | null }[];
        throw error;
      }
      return (data ?? []) as { id: string; title: string | null; latitude: number | null; longitude: number | null }[];
    },
  });

  const growthLocationsQuery = useQuery({
    queryKey: ["scout-growth-locations", selectedVineyardId, linkedGrowthIds.join("|")],
    enabled: linkedGrowthIds.length > 0 && canonicalGrowthIds.size > 0,
    queryFn: async () => {
      const ids = linkedGrowthIds.filter((id) => canonicalGrowthIds.has(id));
      if (!ids.length) return [] as { id: string; latitude: number | null; longitude: number | null }[];
      const { data, error } = await supabase
        .from("growth_stage_records" as any)
        .select("id, latitude, longitude")
        .in("id", ids)
        .is("deleted_at", null);
      if (error) {
        if (isPermissionError(error)) return [] as { id: string; latitude: number | null; longitude: number | null }[];
        throw error;
      }
      return (data ?? []) as { id: string; latitude: number | null; longitude: number | null }[];
    },
  });

  const paddocksQuery = useQuery({
    queryKey: ["paddocks-geo", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paddocks")
        .select("id, name, polygon_points")
        .eq("vineyard_id", selectedVineyardId!)
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []) as { id: string; name: string | null; polygon_points: unknown }[];
    },
  });

  const paddockName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of paddocksQuery.data ?? []) m.set(p.id, p.name ?? "Unnamed block");
    return m;
  }, [paddocksQuery.data]);

  const boundaries = useMemo(() => {
    if (!detail) return [];
    const ids = new Set(detail.assessments.map((a) => a.paddock_id).filter(Boolean));
    return (paddocksQuery.data ?? [])
      .filter((p) => ids.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        ring: (parsePolygonPoints(p.polygon_points) ?? []).map(
          (pt) => [pt.lat, pt.lng] as [number, number],
        ),
      }))
      .filter((b) => b.ring.length > 2);
  }, [detail, paddocksQuery.data]);

  const markers = useMemo<ScoutMapMarker[]>(() => {
    if (!detail) return [];
    const out: ScoutMapMarker[] = [];
    detail.assessments.forEach((a, i) => {
      const obs = detail.observationsByAssessment.get(a.id) ?? [];
      for (const o of obs) {
        const c = measuredCoord(o);
        if (c) {
          out.push({
            id: o.id,
            lat: c.lat,
            lng: c.lng,
            title: `${stopLabel(a, i)} — ${o.item_kind}`,
            colour: "#3B82F6",
          });
        }
        for (const p of detail.photosByObservation.get(o.id) ?? []) {
          const pc = measuredCoord(p);
          if (pc) {
            out.push({
              id: p.id,
              lat: pc.lat,
              lng: pc.lng,
              title: `${stopLabel(a, i)} — photo`,
              colour: "#F59E0B",
            });
          }
        }
      }
    });
    return out;
  }, [detail]);

  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? "Vineyard";

  const exportPdf = async () => {
    if (!detail || !selectedVineyardId) return;
    setExporting(true);
    const omissions: string[] = [];
    try {
      // Embed photos that can be signed; disclose the rest.
      const photoImages = new Map<string, string>();
      const allPhotos = Array.from(detail.photosByObservation.values()).flat();
      for (const p of allPhotos) {
        const url = await signScoutPhotoUrl(p.storage_path);
        if (!url) {
          omissions.push(`A photo on observation ${p.observation_id.slice(0, 8)} could not be loaded for export.`);
          continue;
        }
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error("fetch failed");
          const blob = await res.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ""));
            reader.onerror = () => reject(new Error("read failed"));
            reader.readAsDataURL(blob);
          });
          photoImages.set(p.id, dataUrl);
        } catch {
          omissions.push(`A photo on observation ${p.observation_id.slice(0, 8)} could not be embedded.`);
        }
      }

      const model: ScoutPdfModel = {
        visit: detail.visit,
        vineyardName,
        stops: detail.assessments.map((a) => ({
          assessment: a,
          blockName: a.paddock_id ? paddockName.get(a.paddock_id) ?? null : null,
          observations: detail.observationsByAssessment.get(a.id) ?? [],
          photosByObservation: detail.photosByObservation,
          photoImages,
          canonicalGrowthIds,
        })),
        omissions,
      };
      const branding = await loadScoutReportBranding(detail.visit.vineyard_id);
      const doc = buildScoutReportPdf(model, branding);
      doc.save(scoutReportFilename(detail.visit));
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "The PDF could not be created.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading scout report…
      </div>
    );
  }

  if (detailQuery.error && isPermissionError(detailQuery.error)) {
    return (
      <div className="p-4 sm:p-6">
        <Card>
          <CardContent className="flex items-start gap-3 p-6">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Access to Scout Reports is restricted</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The shared database currently limits Scout Reports to System Administrators.
                A permission update for vineyard members is awaiting approval.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (detailQuery.error || !detail) {
    return (
      <div className="p-4 sm:p-6">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {detailQuery.error
              ? `The report could not be loaded: ${(detailQuery.error as Error).message}`
              : "This scout report was not found for the selected vineyard."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const { visit } = detail;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHead
        title={`Scout Report ${formatDate(visit.scout_date)} — VineTrack Portal`}
        description="Read-only scout report synced from the VineTrack mobile apps."
        path={`/observations/scout-reports/${visit.id}`}
        noindex
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/observations/scout-reports">
              <ArrowLeft className="mr-1 h-4 w-4" /> Scout Reports
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">
              Scout Report — {formatDate(visit.scout_date)}
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant={visit.status === "completed" ? "default" : "secondary"} className="capitalize">
                {visit.status}
              </Badge>
              {visit.vintage_year != null && <span>Vintage {visit.vintage_year}</span>}
              <span>Scout: {visit.scout_name_snapshot ?? "not recorded"}</span>
            </div>
          </div>
        </div>
        <Button onClick={exportPdf} disabled={exporting} variant="outline" size="sm">
          {exporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Export PDF
        </Button>
      </div>

      {visit.visit_summary && (
        <Card>
          <CardContent className="p-4 text-sm">{visit.visit_summary}</CardContent>
        </Card>
      )}

      <WeatherCard title="Visit weather (captured at the time)" snapshot={visit.weather_snapshot} />

      <div>
        <h2 className="mb-2 text-sm font-medium">Locations</h2>
        <ScoutStopsMap markers={markers} boundaries={boundaries} />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">Stops</h2>
        {detail.assessments.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              No block stops were recorded for this visit.
            </CardContent>
          </Card>
        ) : (
          detail.assessments.map((a, i) => {
            const observations = detail.observationsByAssessment.get(a.id) ?? [];
            return (
              <Card key={a.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{stopLabel(a, i)}</span>
                    {a.paddock_id && (
                      <span className="text-sm text-muted-foreground">
                        {paddockName.get(a.paddock_id) ?? "Unnamed block"}
                      </span>
                    )}
                    <Badge variant="outline" className="capitalize">
                      {a.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {stopTime(a) ? formatDateTime(stopTime(a)) : "Stop time not recorded"}
                    </span>
                  </div>

                  <WeatherCard title="Stop weather" snapshot={stopWeather(a)} />

                  {observations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No observations recorded at this stop.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {observations.map((o: ScoutObservation) => {
                        const photos = detail.photosByObservation.get(o.id) ?? [];
                        return (
                          <div key={o.id} className="rounded-md border p-3">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span className="text-sm font-medium">{o.item_kind}</span>
                              <span className="text-sm">
                                {o.value_label ?? o.value_code ?? "No value recorded"}
                              </span>
                            </div>
                            {o.notes && (
                              <p className="mt-1 text-sm text-muted-foreground">{o.notes}</p>
                            )}
                            <p className="mt-1 text-xs text-muted-foreground">
                              Location: {locationLabel(o)}
                            </p>
                            {o.linked_growth_record_id && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {canonicalGrowthIds.has(o.linked_growth_record_id)
                                  ? "Linked growth stage record: verified canonical record."
                                  : "Linked growth stage: stored snapshot only — the canonical record could not be verified."}
                              </p>
                            )}
                            {o.linked_pin_id && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Linked to a vineyard pin.
                              </p>
                            )}
                            {photos.length > 0 && (
                              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                                {photos.map((p) => (
                                  <ObservationPhoto
                                    key={p.id}
                                    storagePath={p.storage_path}
                                    caption={`${
                                      p.captured_at
                                        ? `Captured ${formatDateTime(p.captured_at)} — `
                                        : ""
                                    }${locationLabel(p)}`}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
