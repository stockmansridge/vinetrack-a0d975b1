// Presentation for the rate-gate safeguard: a new registered lookup that came
// back with no usable canonical rate options. Every action here is a pure
// callback or a plain link — this component performs no reads and no writes.
import { Button } from "@/components/ui/button";
import {
  CHANGE_PRODUCT_LABEL,
  ENTER_MANUALLY_LABEL,
  MANUAL_ENTRY_UNVERIFIED_MESSAGE,
  MISSING_RATE_OPTIONS_MESSAGE,
  OPEN_OFFICIAL_LABEL_LABEL,
  RETRY_LABEL_DETAILS_LABEL,
} from "@/lib/chemicalRateOptionsRecovery";

export function MissingRateOptionsPanel({
  labelUrl,
  canRetry,
  onRetry,
  onManual,
  onChangeProduct,
}: {
  labelUrl?: string | null;
  canRetry: boolean;
  onRetry: () => void;
  onManual: () => void;
  onChangeProduct: () => void;
}) {
  return (
    <div
      role="alert"
      className="mb-2 space-y-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-[11px]"
    >
      <p>{MISSING_RATE_OPTIONS_MESSAGE}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canRetry}
          onClick={onRetry}
        >
          {RETRY_LABEL_DETAILS_LABEL}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!labelUrl}
          asChild={!!labelUrl}
        >
          {labelUrl ? (
            <a href={labelUrl} target="_blank" rel="noopener noreferrer">
              {OPEN_OFFICIAL_LABEL_LABEL}
            </a>
          ) : (
            <span>{OPEN_OFFICIAL_LABEL_LABEL}</span>
          )}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onManual}>
          {ENTER_MANUALLY_LABEL}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onChangeProduct}>
          {CHANGE_PRODUCT_LABEL}
        </Button>
      </div>
      <p className="text-muted-foreground">{MANUAL_ENTRY_UNVERIFIED_MESSAGE}</p>
    </div>
  );
}
