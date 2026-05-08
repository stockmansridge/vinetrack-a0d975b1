import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { pinStyle } from "@/lib/pinStyle";
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
  growth_stage_code?: string | null;
  is_completed?: boolean | null;
  completed_by?: string | null;
  completed_by_user_id?: string | null;
  completed_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  photo_path?: string | null;
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

export default function PinDetailPanel({ pin, paddockName, vineyardName, onClose }: Props) {
  const style = pinStyle(pin.mode);
  const photoUrl = usePinPhoto(pin.photo_path ?? undefined);
  const { selectedVineyardId } = useVineyard();
  const { resolve } = useTeamLookup(selectedVineyardId);

  const createdByName = resolve(pin.created_by);
  const completedByName = resolve(pin.completed_by_user_id, pin.completed_by);

  const coords =
    pin.latitude != null && pin.longitude != null
      ? `${pin.latitude.toFixed(6)}, ${pin.longitude.toFixed(6)}`
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
          <Field label="Row" value={pin.row_number} />
          <Field label="Side" value={pin.side} />
          {coords && (
            <div className="text-xs text-muted-foreground pt-1">
              Coordinates: <span className="font-mono">{coords}</span>
            </div>
          )}
        </Section>

        <Section title="Audit">
          <Field label="Created by" value={createdByName ?? "—"} />
          <Field label="Created at" value={pin.created_at} />
          {pin.is_completed ? (
            <>
              <Field label="Completed by" value={completedByName ?? "Unknown"} />
              <Field label="Completed at" value={pin.completed_at} />
            </>
          ) : (
            <div className="text-sm text-muted-foreground">Not completed</div>
          )}
          <Field label="Updated at" value={pin.updated_at} />
        </Section>

        {pin.photo_path && (
          <div className="pt-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Photo
            </div>
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={pin.title ?? "Pin photo"}
                loading="lazy"
                className="w-full max-h-64 object-cover rounded-md border"
              />
            ) : (
              <div className="h-24 rounded-md bg-muted animate-pulse" />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
