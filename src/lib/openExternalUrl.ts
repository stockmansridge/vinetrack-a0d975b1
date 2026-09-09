/**
 * Secure external links (invoices, private attachments).
 *
 * Previous approach: open a placeholder tab during the click, then navigate it
 * once the signed URL arrived. That is unreliable — `window.open(..., "noopener")`
 * returns `null` even on success, so we could neither detect a blocked popup nor
 * navigate or close the placeholder, and the retry `window.open` after the await
 * was exactly the call Safari blocks.
 *
 * Current approach: fetch the URL first, then render a real, user-clicked
 * anchor (`target="_blank" rel="noopener noreferrer"`). The user's click on that
 * anchor is a genuine user gesture, so no browser blocks it and no orphan blank
 * tab is ever created.
 */
import { useCallback, useRef, useState } from "react";

export const SECURE_LINK_FAILED =
  "The secure link could not be prepared. Please try again.";

export type SecureLinkState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string };

export function secureLinkErrorMessage(
  error: unknown,
  fallback: string = SECURE_LINK_FAILED,
): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export interface UseSecureLinkOptions {
  /** Produces the secure URL. Rejects or returns null/empty on failure. */
  resolve: () => Promise<string | null | undefined>;
  /** Message used when the resolver fails without a usable message. */
  fallbackMessage?: string;
}

export interface UseSecureLink {
  state: SecureLinkState;
  /** Fetch (or re-fetch) the URL. Safe to call from a click handler. */
  request: () => Promise<void>;
  /** Return to the idle state, discarding any prepared URL. */
  reset: () => void;
}

export function useSecureLink({
  resolve,
  fallbackMessage = SECURE_LINK_FAILED,
}: UseSecureLinkOptions): UseSecureLink {
  const [state, setState] = useState<SecureLinkState>({ status: "idle" });
  const inFlight = useRef(false);

  const request = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ status: "loading" });
    try {
      const url = await resolve();
      if (!url) {
        setState({ status: "error", message: fallbackMessage });
        return;
      }
      setState({ status: "ready", url });
    } catch (e) {
      setState({ status: "error", message: secureLinkErrorMessage(e, fallbackMessage) });
    } finally {
      inFlight.current = false;
    }
  }, [resolve, fallbackMessage]);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, request, reset };
}
