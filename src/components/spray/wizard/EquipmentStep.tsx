// Equipment step — the operator must explicitly confirm the spray unit before
// any volume is calculated against it. A value carried in from a Program Step
// or an existing job is a suggestion, never a confirmation.
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StepProps } from "./types";

const NONE = "__none";

export function EquipmentStep({ app, patch, lookups, canEdit }: StepProps) {
  const equipmentRow = lookups.equipment.find((e: any) => e.id === app.equipmentId) as any;
  const equipmentCapacity = Number(equipmentRow?.tank_capacity_litres);
  const hasEquipmentCapacity = Number.isFinite(equipmentCapacity) && equipmentCapacity > 0;


  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Tractor</Label>
          <Select
            value={app.tractorId ?? NONE}
            disabled={!canEdit}
            onValueChange={(v) => patch({ tractorId: v === NONE ? null : v })}
          >
            <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Not set</SelectItem>
              {Array.from(lookups.maps.tractors.entries()).map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Spray equipment</Label>
          <Select
            value={app.equipmentId ?? NONE}
            disabled={!canEdit}
            onValueChange={(v) => {
              const id = v === NONE ? null : v;
              const row = lookups.equipment.find((e: any) => e.id === id) as any;
              const cap = Number(row?.tank_capacity_litres);
              patch({
                equipmentId: id,
                tankCapacityLitres: Number.isFinite(cap) && cap > 0 ? cap : app.tankCapacityLitres,
              });
            }}
          >
            <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Not set</SelectItem>
              {Array.from(lookups.maps.equipment.entries()).map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Operator</Label>
          <Select
            value={app.operatorUserId ?? NONE}
            disabled={!canEdit}
            onValueChange={(v) => patch({ operatorUserId: v === NONE ? null : v })}
          >
            <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Not set</SelectItem>
              {Array.from(lookups.maps.members.entries()).map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {app.operationType !== "spreader" && (
          <div className="space-y-1">
            <Label htmlFor="tank-capacity">Tank capacity (L)</Label>
            <Input
              id="tank-capacity"
              type="number"
              min="0"
              step="1"
              disabled={!canEdit}
              value={app.tankCapacityLitres ?? ""}
              onChange={(e) =>
                patch({ tankCapacityLitres: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
            <p className="text-xs text-muted-foreground">
              {hasEquipmentCapacity
                ? "Prefilled from the selected equipment. Change it to plan with a different tank."
                : "Used only to split the mix into tank loads. Leave blank to skip tank planning."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
