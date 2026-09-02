import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface Props {
  vintage: number;
  options: number[];
  onChange: (vintage: number) => void;
  /** Renders a "Vintage" label above the control. */
  label?: string | null;
  className?: string;
  disabled?: boolean;
}

/**
 * The single Vintage selector used by every dated list, report and export.
 * Offers the current vineyard Vintage plus the previous 15.
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
        value={String(vintage)}
        onValueChange={(v) => onChange(Number(v))}
        disabled={disabled}
      >
        <SelectTrigger className="h-9 w-full sm:w-[150px]" aria-label="Vintage">
          <SelectValue placeholder="Vintage" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
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
