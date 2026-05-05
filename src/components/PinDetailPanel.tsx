import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { pinStyle } from "@/lib/pinStyle";
import { usePinPhoto } from "@/hooks/usePinPhoto";
import { formatCell } from "@/pages/setup/ListPage";

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
  completed_at?: string | null;
  photo_path?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface Props {
  pin: PinRecord;
  paddockName?: string | null;
  onClose: () => void;
}

const Field = ({ label, value }: { label: string; value: any }) =>
  value == null || value === "" ? null : (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{formatCell(value)}</span>
    </div>
  );

export default function PinDetailPanel({ pin, paddockName, onClose }: Props) {
  const style = pinStyle(pin.mode);
  const photoUrl = usePinPhoto(pin.photo_path ?? undefined);

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
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {pin.notes && (
          <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">{pin.notes}</p>
        )}
        <Field label="Paddock" value={paddockName ?? pin.paddock_id ?? null} />
        <Field label="Row" value={pin.row_number} />
        <Field label="Side" value={pin.side} />
        <Field label="Growth stage" value={pin.growth_stage_code} />
        <Field
          label="Coordinates"
          value={
            pin.latitude != null && pin.longitude != null
              ? `${pin.latitude.toFixed(6)}, ${pin.longitude.toFixed(6)}`
              : null
          }
        />
        <Field label="Completed" value={pin.is_completed} />
        <Field label="Completed by" value={pin.completed_by} />
        <Field label="Completed at" value={pin.completed_at} />
        <Field label="Created" value={pin.created_at} />
        <Field label="Updated" value={pin.updated_at} />

        {pin.photo_path && (
          <div className="pt-2">
            <div className="text-xs text-muted-foreground mb-1">Photo</div>
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
