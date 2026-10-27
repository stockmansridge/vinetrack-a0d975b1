// Shared presentation for a failed extraction. The raw backend/OpenAI JSON
// is never rendered inline: the main message is concise, a cleaned one-line
// detail is shown when the backend returned something human-readable, and
// the raw text stays behind a collapsed "Technical details" disclosure.
// Every Soil Analysis screen is System Admin-gated, so the disclosure is
// always appropriate here.
import { EXTRACTION_FAILED_MESSAGE, cleanExtractionDetail } from "@/lib/soilAnalysis";

export function ExtractionErrorNotice({
  raw,
  className,
}: {
  raw: string | null | undefined;
  className?: string;
}) {
  if (!raw || !raw.trim()) return null;
  const clean = cleanExtractionDetail(raw);
  return (
    <div className={className ?? "space-y-1 text-sm"}>
      <div className="font-medium text-destructive">{EXTRACTION_FAILED_MESSAGE}</div>
      {clean && <div className="text-muted-foreground">{clean}</div>}
      <details className="text-muted-foreground">
        <summary className="cursor-pointer select-none">Technical details</summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2">
          {raw}
        </pre>
      </details>
    </div>
  );
}
