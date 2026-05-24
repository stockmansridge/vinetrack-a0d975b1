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
      reason: "iframe" | "popup-blocked" | "navigation-blocked";
      url: string;
      message: string;
    };

export async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
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
    document.execCommand("copy");
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

async function copyAndNotify(url: string, message: string, reason: ExternalMapOpenResult["reason"]) {
  await copyTextToClipboard(url).catch(() => {
    /* noop */
  });

  toast("Map link copied", {
    description: message,
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

  const opened = window.open("about:blank", "_blank", "noopener,noreferrer");

  if (!opened) {
    return copyAndNotify(url, POPUP_BLOCKED_MESSAGE, "popup-blocked");
  }

  try {
    opened.opener = null;
  } catch {
    /* noop */
  }

  try {
    opened.location.replace(url);
    return {
      status: "opened",
      reason: "new-tab",
      url,
    };
  } catch {
    try {
      opened.close();
    } catch {
      /* noop */
    }
    return copyAndNotify(url, POPUP_BLOCKED_MESSAGE, "navigation-blocked");
  }
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