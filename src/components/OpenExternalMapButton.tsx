import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { toast } from "sonner";

async function copyTextToClipboard(text: string) {
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

async function showBlockedToast(url: string) {
  await copyTextToClipboard(url).catch(() => {
    /* noop */
  });

  toast("Map link copied", {
    description: "Your browser blocked opening the map. Paste the copied link into your browser.",
  });
}

export async function openExternalMap(url: string) {
  const opened = window.open("", "_blank", "noopener,noreferrer");

  if (!opened) {
    await showBlockedToast(url);
    return;
  }

  try {
    opened.opener = null;
  } catch {
    /* noop */
  }

  try {
    opened.location.replace(url);
  } catch {
    try {
      opened.close();
    } catch {
      /* noop */
    }
    await showBlockedToast(url);
  }
}

interface OpenExternalMapButtonProps extends Omit<ButtonProps, "asChild" | "onClick" | "type"> {
  url: string;
}

export default function OpenExternalMapButton({ url, children, ...buttonProps }: OpenExternalMapButtonProps) {
  const handleClick = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      await openExternalMap(url);
    },
    [url],
  );

  return (
    <Button type="button" onClick={handleClick} {...buttonProps}>
      {children}
    </Button>
  );
}