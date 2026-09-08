import { Button } from "@/components/ui/button";

interface Props {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Loading / error banner for the Irrigation Advisor soil section. */
export default function SoilProfileStatus({ loading, error, onRetry }: Props) {
  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading soil profiles…</p>;
  }
  if (!error) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-destructive">
        Could not load soil profiles: {(error as any)?.message ?? "unknown error"}. Soil
        buffer values below may be out of date.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
