import { copyTextToClipboard } from "@/components/OpenExternalMapButton";

/**
 * Safari-safe "open a URL we don't have yet" helper.
 *
 * Safari only allows `window.open` while the user's tap/click is still being
 * handled. Awaiting a signed URL first breaks that link, and the tab is
 * silently blocked. So we open a placeholder tab synchronously during the
 * click, then point it at the signed URL once it arrives.
 */
export interface DeferredTab {
  /** True when the browser refused the placeholder tab. */
  readonly blocked: boolean;
  /** Send the resolved URL to the tab (or fall back when blocked). */
  settle: (url: string) => Promise<void>;
  /** Close the placeholder tab because the URL could not be produced. */
  fail: () => void;
}

const LOADING_DOC =
  "<!doctype html><meta charset=utf-8><title>Opening…</title>" +
  "<body style=\"font:16px system-ui;padding:2rem;color:#333\">Preparing your secure link…</body>";

export function openDeferredTab(): DeferredTab {
  let tab: Window | null = null;
  try {
    tab = window.open("", "_blank", "noopener,noreferrer");
  } catch {
    tab = null;
  }

  if (tab) {
    try {
      tab.opener = null;
      tab.document.write(LOADING_DOC);
      tab.document.close();
    } catch {
      /* cross-origin about:blank quirks — harmless */
    }
  }

  return {
    blocked: !tab,
    async settle(url: string) {
      if (tab && !tab.closed) {
        try {
          tab.location.replace(url);
          return;
        } catch {
          /* fall through to the blocked path */
        }
      }
      // No tab: try one direct open (some browsers still allow it), then copy.
      const direct = window.open(url, "_blank", "noopener,noreferrer");
      if (direct) {
        try {
          direct.opener = null;
        } catch {
          /* noop */
        }
        return;
      }
      await copyTextToClipboard(url).catch(() => {
        /* noop */
      });
      throw new PopupBlockedError();
    },
    fail() {
      if (tab && !tab.closed) {
        try {
          tab.close();
        } catch {
          /* noop */
        }
      }
    },
  };
}

export class PopupBlockedError extends Error {
  constructor() {
    super(
      "Your browser blocked the new tab. The link has been copied — paste it into a new tab to continue.",
    );
    this.name = "PopupBlockedError";
  }
}
