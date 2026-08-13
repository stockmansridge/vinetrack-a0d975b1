// Per-row manual vine-count override editor — SQL 188 (consumer only).
//
// Shows, for every row: the automatic estimate, the optional manual override,
// and the effective count actually used. Blank = no override.
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  calculatedRowVineCount,
  parseVineCountOverrideInput,
  type RawPaddockRow,
} from "@/lib/paddockRowVines";

interface Props {
  rows: RawPaddockRow[];
  vineSpacingM: number | null;
  rowLengthOverrideM: number | null;
  /** Raw text keyed by row number. Absent key = untouched (use stored value). */
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}

export default function RowVineCountOverrides({
  rows, vineSpacingM, rowLengthOverrideM, values, onChange, disabled,
}: Props) {
  if (!rows.length) return null;

  return (
    <div className="rounded-md border">
      <div className="grid grid-cols-[minmax(0,1fr)_120px_130px_110px] gap-2 px-3 py-2 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
        <span>Row</span>
        <span className="text-right">Calculated vines</span>
        <span className="text-right">Manual override</span>
        <span className="text-right">Using</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto divide-y">
        {rows.map((r, i) => {
          const number = Number(r?.number);
          const key = String(Number.isFinite(number) ? number : i);
          const calculated = calculatedRowVineCount(r, vineSpacingM, rowLengthOverrideM);
          const text = values[key] ?? "";
          const parsed = parseVineCountOverrideInput(text);
          const override = parsed.ok ? parsed.value : null;
          const effective = override ?? calculated;
          return (
            <div key={key} className="grid grid-cols-[minmax(0,1fr)_120px_130px_110px] gap-2 px-3 py-2 items-center">
              <span className="text-sm font-medium">Row {key}</span>
              <span className="text-sm text-right tabular-nums text-muted-foreground">
                {calculated != null ? calculated.toLocaleString() : "—"}
              </span>
              <div className="flex justify-end">
                <Input
                  className={`h-8 text-right tabular-nums ${!parsed.ok ? "border-destructive" : ""}`}
                  inputMode="numeric"
                  placeholder="—"
                  value={text}
                  disabled={disabled}
                  aria-label={`Manual vine count override for row ${key}`}
                  onChange={(e) => onChange({ ...values, [key]: e.target.value })}
                />
              </div>
              <span className="text-sm text-right tabular-nums font-medium">
                {effective != null ? `${effective.toLocaleString()} vines` : "—"}
                {override != null && (
                  <Badge variant="secondary" className="ml-2 align-middle">Manual</Badge>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <p className="px-3 py-2 text-xs text-muted-foreground border-t">
        {!(Number(vineSpacingM) > 0)
          ? "Set vine spacing in block details to calculate vines."
          : "Whole positive numbers only. Leave blank to use the calculated estimate. Overrides are shared with the VineTrack mobile apps."}
      </p>
    </div>
  );
}
