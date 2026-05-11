import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { pinStyle, formatAttachedRow, formatDrivingPath, formatLegacyRow, pinDisplayTitle } from "@/lib/pinStyle";
import { usePinPhoto } from "@/hooks/usePinPhoto";
import { formatCell } from "@/pages/setup/ListPage";
import { useTeamLookup } from "@/hooks/useTeamLookup";
import { useVineyard } from "@/context/VineyardContext";

export interface PinRecord {
  id: string;
  vineyard_id: string;
  paddock_id?: string | null;
  mode?: string | null;
  category?: string | null;
  priority?: string | null;
  status?: string | null;
  title?: string | null;
  button_name?: string | null;
  button_color?: string | null;
  notes?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  row_number?: number | null;
  side?: string | null;
  driving_row_number?: number | null;
  pin_row_number?: number | null;
  pin_side?: string | null;
  along_row_distance_m?: number | null;
  snapped_latitude?: number | null;
  snapped_longitude?: number | null;
  snapped_to_row?: boolean | null;
  growth_stage_code?: string | null;
  is_completed?: boolean | null;
  completed_by?: string | null;
  completed_by_user_id?: string | null;
  completed_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  photo_path?: string | null;
  photo_url?: string | null;
  image_url?: string | null;
  attachment_path?: string | null;
  attachment_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface Props {
  pin: PinRecord;
  paddockName?: string | null;
  vineyardName?: string | null;
  onClose: () => void;
}

const Field = ({ label, value }: { label: string; value: any }) =>
  value == null || value === "" ? null : (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium break-words">{formatCell(value)}</span>
    </div>
  );

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
    <div className="space-y-1.5 rounded-md border bg-muted/30 p-2.5">{children}</div>
  </div>
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatDateTime(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PinDetailPanel({ pin, paddockName, vineyardName, onClose }: Props) {
  const style = pinStyle(pin.mode, pin.button_color, pin.category);
  // Pins may store photo as a storage path (signed) or as a direct URL.
  const photoPath = pin.photo_path ?? pin.attachment_path ?? null;
  const directPhotoUrl =
    pin.photo_url ?? pin.image_url ?? pin.attachment_url ?? null;
  const signedPhotoUrl = usePinPhoto(photoPath ?? undefined);
  const photoUrl = directPhotoUrl ?? signedPhotoUrl;
  const hasPhotoRef = !!(photoPath || directPhotoUrl);
  const { selectedVineyardId } = useVineyard();
  const { lookup, resolve } = useTeamLookup(pin.vineyard_id ?? selectedVineyardId);

  // Resolve `created_by`: it may be a UUID (resolve via team) or a free-text
  // name/email from older clients. Never display a raw UUID.
  const createdByRaw = (pin.created_by ?? "").trim();
  let createdByDisplay: string;
  if (!createdByRaw) {
    createdByDisplay = "Not recorded";
  } else if (UUID_RE.test(createdByRaw)) {
    createdByDisplay = resolve(createdByRaw) ?? "Unknown member";
  } else {
    createdByDisplay = createdByRaw;
  }

  // Completed by: prefer user_id lookup, then text fallback, then "Not completed".
  let completedByDisplay: string;
  if (!pin.is_completed) {
    completedByDisplay = "Not completed";
  } else {
    const fromId = pin.completed_by_user_id
      ? resolve(pin.completed_by_user_id)
      : null;
    const txt = (pin.completed_by ?? "").trim();
    completedByDisplay =
      fromId ??
      (txt && !UUID_RE.test(txt) ? txt : null) ??
      (pin.completed_by_user_id ? "Unknown member" : "Not recorded");
  }

  const createdAtDisplay = formatDateTime(pin.created_at) ?? "Not recorded";
  const completedAtDisplay = pin.is_completed
    ? formatDateTime(pin.completed_at) ?? "Not recorded"
    : "Not completed";

  const coords =
    pin.latitude != null && pin.longitude != null
      ? `${pin.latitude.toFixed(6)}, ${pin.longitude.toFixed(6)}`
      : null;

  const debugAuditInfo = import.meta.env.DEV
    ? `created_by=${!createdByRaw ? "null" : UUID_RE.test(createdByRaw) ? "uuid" : "text"} · team members=${lookup.size} · matched=${createdByRaw && UUID_RE.test(createdByRaw) && lookup.has(createdByRaw) ? "yes" : "no"}`
    : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-2">
        <div className="space-y-1.5 min-w-0">
          <CardTitle className="text-base truncate">
            {pin.title?.trim() || pin.button_name?.trim() || pin.mode?.trim() || "Untitled pin"}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="secondary"
              className="capitalize"
              style={{ background: style.hex + "22", color: style.hex }}
            >
              {style.label}
            </Badge>
            {pin.category && <Badge variant="outline">{pin.category}</Badge>}
            {pin.priority && <Badge variant="outline">{pin.priority}</Badge>}
            {pin.status && <Badge variant="outline">{pin.status}</Badge>}
            <Badge variant={pin.is_completed ? "default" : "outline"}>
              {pin.is_completed ? "Completed" : "Not completed"}
            </Badge>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {pin.notes && (
          <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">{pin.notes}</p>
        )}

        <Section title="Details">
          <Field label="Title" value={pin.title} />
          <Field label="Mode" value={pin.mode} />
          <Field label="Category" value={pin.category} />
          <Field label="Priority" value={pin.priority} />
          <Field label="Status" value={pin.status} />
          <Field label="Growth stage" value={pin.growth_stage_code} />
        </Section>

        <Section title="Location">
          <Field label="Vineyard" value={vineyardName} />
          <Field label="Paddock" value={paddockName} />
          <Field label="Attached row" value={formatAttachedRow(pin)} />
          <Field label="Driving path" value={formatDrivingPath(pin)} />
          {!formatAttachedRow(pin) && !formatDrivingPath(pin) && (
            <>
              <Field label="Row" value={formatLegacyRow(pin)} />
              <Field label="Side" value={pin.side} />
            </>
          )}
          {coords && (
            <div className="text-xs text-muted-foreground pt-1">
              Coordinates: <span className="font-mono">{coords}</span>
            </div>
          )}
        </Section>

        <Section title="Audit">
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Created by</span>
            <span className="text-right font-medium break-words">{createdByDisplay}</span>
          </div>
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Created at</span>
            <span className="text-right font-medium break-words">{createdAtDisplay}</span>
          </div>
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Completed by</span>
            <span className="text-right font-medium break-words">{completedByDisplay}</span>
          </div>
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Completed at</span>
            <span className="text-right font-medium break-words">{completedAtDisplay}</span>
          </div>
          {pin.updated_at && (
            <div className="flex justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Updated at</span>
              <span className="text-right font-medium break-words">
                {formatDateTime(pin.updated_at) ?? "—"}
              </span>
            </div>
          )}
          {debugAuditInfo && (
            <div className="pt-1 text-[11px] text-muted-foreground">
              {debugAuditInfo}
            </div>
          )}
        </Section>

        {hasPhotoRef && (
          <div className="pt-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Photo
            </div>
            {photoUrl ? (
              <a href={photoUrl} target="_blank" rel="noreferrer" className="block">
                <img
                  src={photoUrl}
                  alt={pin.title ?? "Pin photo"}
                  loading="lazy"
                  className="w-full max-h-64 object-cover rounded-md border hover:opacity-90 transition"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                    const sib = e.currentTarget.nextElementSibling as HTMLElement | null;
                    if (sib) sib.style.display = "flex";
                  }}
                />
                <div
                  className="hidden h-24 rounded-md border bg-muted/50 items-center justify-center text-xs text-muted-foreground"
                >
                  Image unavailable
                </div>
              </a>
            ) : photoPath ? (
              <div className="h-24 rounded-md bg-muted animate-pulse" />
            ) : (
              <div className="h-24 rounded-md border bg-muted/50 flex items-center justify-center text-xs text-muted-foreground">
                Image unavailable
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
