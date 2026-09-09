import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { toast } from "sonner";

const EMBEDDED_PREVIEW_MESSAGE =
  "External maps may be blocked inside the Lovable preview. The link has been copied. Test from the deployed portal URL.";
const POPUP_BLOCKED_MESSAGE =
  "A new tab could not be opened. The link has been copied so you can paste it into your browser.";

export type ExternalMapOpenResult =
  | {
      status: "opened";
      reason: "new-tab";
      url: string;
    }
  | {
      status: "copied";
      reason: "iframe" | "popup-blocked";
      url: string;
      message: string;
    };

type CopiedReason = Extract<ExternalMapOpenResult, { status: "copied" }>["reason"];

/**
 * Copy text to the clipboard.
 * Returns true only when the copy actually succeeded, so callers never claim
 * "copied" after a rejected clipboard write or a failed execCommand fallback.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the legacy path */
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function isEmbeddedContext() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

async function copyAndNotify(url: string, message: string, reason: CopiedReason): Promise<ExternalMapOpenResult> {
  const copied = await copyTextToClipboard(url).catch(() => false);

  toast(copied ? "Map link copied" : "Map link could not be copied", {
    description: copied
      ? message
      : "Copying was blocked by your browser. Select the address shown and copy it manually.",
  });

  return {
    status: "copied" as const,
    reason,
    url,
    message,
  };
}

export async function openExternalMap(url: string): Promise<ExternalMapOpenResult> {
  if (isEmbeddedContext()) {
    return copyAndNotify(url, EMBEDDED_PREVIEW_MESSAGE, "iframe");
  }

  const opened = window.open(url, "_blank");

  if (!opened) {
    return copyAndNotify(url, POPUP_BLOCKED_MESSAGE, "popup-blocked");
  }

  try {
    opened.opener = null;
  } catch {
    /* noop */
  }

  return {
    status: "opened",
    reason: "new-tab",
    url,
  };
}

interface OpenExternalMapButtonProps extends Omit<ButtonProps, "asChild" | "onClick" | "type"> {
  url: string;
  onResult?: (result: ExternalMapOpenResult) => void | Promise<void>;
}

export default function OpenExternalMapButton({ url, children, onResult, ...buttonProps }: OpenExternalMapButtonProps) {
  const handleClick = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const result = await openExternalMap(url);
      await onResult?.(result);
    },
    [onResult, url],
  );

  return (
    <Button type="button" onClick={handleClick} {...buttonProps}>
      {children}
    </Button>
  );
}