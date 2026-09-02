import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const ALL = "__all__";

interface Props {
  /** Selected Vintage, or null for "All vintages". */
  vintage: number | null;
  /** Vintages that actually contain records for this surface, newest first. */
  options: number[];
  onChange: (vintage: number | null) => void;
  /** Renders a "Vintage" label above the control. */
  label?: string | null;
  className?: string;
  disabled?: boolean;
}

/**
 * The single Vintage selector used by every dated list, report and export.
 * "All vintages" first, then only the Vintages containing records.
 */
export function VintageSelect({
  vintage,
  options,
  onChange,
  label = "Vintage",
  className,
  disabled,
}: Props) {
  return (
    <div className={className}>
      {label && (
        <Label className="mb-1 block text-xs text-muted-foreground">{label}</Label>
      )}
      <Select
        value={vintage == null ? ALL : String(vintage)}
        onValueChange={(v) => onChange(v === ALL ? null : Number(v))}
        disabled={disabled}
      >
        <SelectTrigger className="h-9 w-full sm:w-[150px]" aria-label="Vintage">
          <SelectValue placeholder="Vintage" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value={ALL}>All vintages</SelectItem>
          {options.map((y) => (
            <SelectItem key={y} value={String(y)}>
              Vintage {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default VintageSelect;
