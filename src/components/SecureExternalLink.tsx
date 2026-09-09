// Prepare-then-open control for private links (invoices, support attachments).
//
// Step 1: the user asks for the link — we fetch it and show a loading state.
// Step 2: a real anchor appears, which the user clicks to open the file in a
//         new tab. Because the tab is opened by that click, no browser blocks
//         it and we never leave an empty tab behind.
import * as React from "react";
import { ExternalLink, Loader2, Copy, RefreshCw } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { copyTextToClipboard } from "@/components/OpenExternalMapButton";
import { useSecureLink } from "@/lib/openExternalUrl";

interface SecureExternalLinkProps {
  /** Fetches the secure URL. */
  resolve: () => Promise<string | null | undefined>;
  /** Label of the initial button, e.g. "View invoice". */
  prepareLabel: string;
  /** Label of the anchor once the link is ready, e.g. "Open invoice". */
  openLabel: string;
  /** Message shown when the link cannot be prepared. */
  fallbackMessage?: string;
  /** Suggested filename for downloads. */
  downloadName?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  className?: string;
  icon?: React.ReactNode;
}

export default function SecureExternalLink({
  resolve,
  prepareLabel,
  openLabel,
  fallbackMessage,
  downloadName,
  size = "sm",
  variant = "ghost",
  className,
  icon,
}: SecureExternalLinkProps) {
  const { state, request, reset } = useSecureLink({ resolve, fallbackMessage });
  const [copyNote, setCopyNote] = React.useState<string | null>(null);

  const handleCopy = React.useCallback(async () => {
    if (state.status !== "ready") return;
    const ok = await copyTextToClipboard(state.url);
    setCopyNote(
      ok
        ? "Link copied."
        : "The link could not be copied automatically — use the Open button, or select and copy the address manually.",
    );
  }, [state]);

  if (state.status === "ready") {
    return (
      <span className={className}>
        <span className="inline-flex flex-wrap items-center gap-1">
          <a
            href={state.url}
            target="_blank"
            rel="noopener noreferrer"
            download={downloadName}
            onClick={() => setCopyNote(null)}
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-xs font-medium text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            {openLabel}
          </a>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={handleCopy}
          >
            <Copy className="mr-1 h-3 w-3" aria-hidden="true" /> Copy link
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={reset}
          >
            Done
          </Button>
        </span>
        {copyNote && (
          <span className="mt-1 block text-[11px] text-muted-foreground">{copyNote}</span>
        )}
        <span className="mt-1 block break-all text-[11px] text-muted-foreground">
          {state.url}
        </span>
      </span>
    );
  }

  if (state.status === "error") {
    return (
      <span className={className}>
        <span className="block text-xs text-destructive">{state.message}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-1 h-7 px-2 text-xs"
          onClick={() => void request()}
        >
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" /> Retry
        </Button>
      </span>
    );
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      disabled={state.status === "loading"}
      onClick={() => void request()}
    >
      {state.status === "loading" ? (
        <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <span className="mr-1 inline-flex">{icon ?? <ExternalLink className="h-4 w-4" aria-hidden="true" />}</span>
      )}
      {state.status === "loading" ? "Preparing link…" : prepareLabel}
    </Button>
  );
}
