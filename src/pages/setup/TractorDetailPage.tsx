import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronDown, Pencil, Tractor as TractorIcon, Wrench } from "lucide-react";
import { fetchOne } from "@/lib/queries";
import { useVineyard } from "@/context/VineyardContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import TractorReferencePhoto from "@/components/equipment/TractorReferencePhoto";
import { formatFuelUsage } from "@/lib/tractorFuel";


interface TractorRow {
  id: string;
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  model_year?: number | null;
  fuel_usage_l_per_hour?: number | null;
  serial_number?: string | null;
  vin_number?: string | null;
  vineyard_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const fmtDateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;


function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-foreground">
        {value ?? <span className="font-normal text-muted-foreground">Not recorded</span>}
      </dd>
    </div>
  );
}

export default function TractorDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentRole } = useVineyard();
  const [showSystemInfo, setShowSystemInfo] = useState(false);
  const canEdit = currentRole === "owner" || currentRole === "manager";

  const { data, isLoading, error } = useQuery({
    queryKey: ["detail", "tractors", id],
    enabled: !!id,
    queryFn: () => fetchOne("tractors", id!) as Promise<TractorRow | null>,
  });

  const t = data as TractorRow | null | undefined;
  const subtitle = t ? [t.brand, t.model, t.model_year].filter(Boolean).join(" · ") : "";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {canEdit && t && (
          <Button size="sm" onClick={() => navigate(`/setup/tractors?edit=${t.id}`)}>
            <Pencil className="h-4 w-4" /> Edit tractor
          </Button>
        )}
        {t && (
          <Button
            size="sm"
            variant="outline"
            aria-expanded={showSystemInfo}
            onClick={() => setShowSystemInfo((v) => !v)}
          >
            <Wrench className="h-4 w-4" /> System info
            <ChevronDown className={`h-4 w-4 transition-transform ${showSystemInfo ? "rotate-180" : ""}`} />
          </Button>
        )}
        <Button variant="ghost" size="sm" asChild>
          <Link to="/setup/tractors">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
      </div>
      {t && showSystemInfo && (
        <Card>
          <CardContent className="p-4">
            <div className="space-y-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Record ID</dt>
                <dd className="mt-1 break-all font-mono text-xs text-foreground">{t.id}</dd>
              </div>
              {t.vineyard_id && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vineyard ID</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-foreground">{t.vineyard_id}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Added</dt>
                <dd className="mt-1 text-sm text-foreground">{fmtDateTime(t.created_at) ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last updated</dt>
                <dd className="mt-1 text-sm text-foreground">{fmtDateTime(t.updated_at) ?? "Not recorded"}</dd>
              </div>
              <p className="text-xs text-muted-foreground">
                Internal identifiers for troubleshooting and support only — safe to share with VineTrack support.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-6">
          {isLoading && <div className="text-muted-foreground">Loading…</div>}
          {error && <div className="text-destructive">{(error as Error).message}</div>}
          {!isLoading && !t && !error && <div className="text-muted-foreground">Tractor not found.</div>}
          {t && (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <TractorIcon className="h-7 w-7" />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl font-semibold text-foreground">{t.name || "Unnamed tractor"}</h1>
                  {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
                </div>
                <TractorReferencePhoto
                  tractor={{ brand: t.brand ?? null, model: t.model ?? null, model_year: t.model_year ?? null }}
                />
              </div>
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Item label="Brand" value={t.brand} />
                <Item label="Model" value={t.model} />
                <Item label="Year" value={t.model_year} />
                <Item label="Fuel usage" value={formatFuelUsage(t.fuel_usage_l_per_hour)} />
                <Item label="Serial number" value={t.serial_number} />
                <Item label="VIN" value={t.vin_number} />
              </dl>

            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
