import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Pencil, ChevronDown } from "lucide-react";
import { useState } from "react";
import {
  usePaddockSoilProfile,
  computeRootZoneCapacityMm,
  computeReadilyAvailableWaterMm,
  NSW_SEED_DISCLAIMER,
} from "@/lib/soilProfiles";
import { useDiagnosticPanel } from "@/lib/systemAdmin";
import SoilProfileEditDialog from "./SoilProfileEditDialog";
import NswSeedLookupButton from "./NswSeedLookupButton";

interface Props {
  paddockId: string;
  paddockName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Owners/managers can edit. If unknown, pass undefined to allow. */
  canEdit?: boolean;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

const fmt = (n: any, d = 1) =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(d) : "—";

export default function SoilProfileSection({
  paddockId,
  paddockName,
  latitude,
  longitude,
  canEdit = true,
}: Props) {
  const { data: profile, isLoading } = usePaddockSoilProfile(paddockId);
  const showRawDiagnostics = useDiagnosticPanel("show_raw_json_panels");
  const [rawOpen, setRawOpen] = useState(false);

  const cap = computeRootZoneCapacityMm(
    profile?.awc_mm_per_m as number | null,
    profile?.effective_root_depth_m as number | null,
  );
  const raw = computeReadilyAvailableWaterMm(
    cap,
    profile?.allowed_depletion_percent as number | null,
  );

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1 flex items-center justify-between">
        <span>Soil</span>
        <div className="flex items-center gap-1">
          {canEdit && (
            <NswSeedLookupButton
              paddockId={paddockId}
              latitude={latitude}
              longitude={longitude}
              current={profile ?? null}
            />
          )}
          {canEdit && (
            <SoilProfileEditDialog
              paddockId={paddockId}
              paddockName={paddockName}
              current={profile ?? null}
              trigger={
                <Button variant="ghost" size="sm">
                  <Pencil className="h-3 w-3 mr-1" /> Edit
                </Button>
              }
            />
          )}
        </div>
      </div>

      {isLoading && (
        <div className="text-xs text-muted-foreground">Loading soil profile…</div>
      )}

      {!isLoading && !profile && (
        <div className="text-xs text-muted-foreground">
          No soil profile set.{" "}
          {canEdit ? "Fetch from NSW SEED or enter manually." : ""}
        </div>
      )}

      {profile && (
        <div className="space-y-1 text-sm">
          <Row
            label="Soil class"
            value={
              (profile.irrigation_soil_class as string) ?? <span className="text-muted-foreground">—</span>
            }
          />
          <Row label="Soil landscape" value={(profile.soil_landscape as string) ?? "—"} />
          <Row label="SALIS code" value={(profile.salis_code as string) ?? "—"} />
          <Row
            label="Aust. Soil Classification"
            value={(profile.australian_soil_classification as string) ?? "—"}
          />
          <Row
            label="Land & Soil Capability"
            value={(profile.land_and_soil_capability as string) ?? "—"}
          />
          <Row
            label="Available water capacity"
            value={
              profile.awc_mm_per_m != null ? `${fmt(profile.awc_mm_per_m, 0)} mm/m` : "—"
            }
          />
          <Row
            label="Effective root depth"
            value={
              profile.effective_root_depth_m != null
                ? `${fmt(profile.effective_root_depth_m, 2)} m`
                : "—"
            }
          />
          <Row
            label="Allowed depletion"
            value={
              profile.allowed_depletion_percent != null
                ? `${fmt(profile.allowed_depletion_percent, 0)} %`
                : "—"
            }
          />
          <Row
            label="Root-zone capacity"
            value={cap != null ? `${fmt(cap, 1)} mm` : "—"}
          />
          <Row
            label="Readily available water"
            value={raw != null ? `${fmt(raw, 1)} mm` : "—"}
          />
          <Row
            label="Confidence"
            value={(profile.confidence as string) ?? "—"}
          />
          <Row
            label="Source"
            value={
              <span className="flex items-center gap-1">
                {(profile.provider as string) ?? (profile.source as string) ?? "—"}
                {profile.manual_override ? (
                  <Badge variant="outline">Manual override</Badge>
                ) : null}
              </span>
            }
          />
          {profile.manual_notes ? (
            <Row label="Notes" value={(profile.manual_notes as string) ?? "—"} />
          ) : null}

          {(profile.provider === "nsw_seed" || profile.source === "nsw_seed") && (
            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
              {NSW_SEED_DISCLAIMER}
            </p>
          )}

          {showRawDiagnostics && profile.raw ? (
            <Collapsible open={rawOpen} onOpenChange={setRawOpen} className="mt-2">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded border bg-muted/30 px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  <span>NSW SEED raw response (admin)</span>
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${rawOpen ? "rotate-180" : ""}`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-1 max-h-64 overflow-auto rounded border bg-background p-2 text-[10px] leading-tight font-mono whitespace-pre-wrap break-words">
                  {JSON.stringify(profile.raw, null, 2)}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      )}
    </div>
  );
}
