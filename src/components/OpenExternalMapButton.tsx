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

export function openExternalMap(url: string) {
  const opened = window.open(url, "_blank", "noopener,noreferrer");

  if (opened) {
    try {
      opened.opener = null;
    } catch {
      /* noop */
    }
    return;
  }

  copyTextToClipboard(url)
    .catch(() => {
      /* noop */
    })
    .finally(() => {
      toast("Map link copied", {
        description: "Your browser blocked opening the map. Paste the copied link into your browser.",
      });
    });
}

interface OpenExternalMapButtonProps extends Omit<ButtonProps, "asChild" | "onClick" | "type"> {
  url: string;
}

export default function OpenExternalMapButton({ url, children, ...buttonProps }: OpenExternalMapButtonProps) {
  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      openExternalMap(url);
    },
    [url],
  );

  return (
    <Button type="button" onClick={handleClick} {...buttonProps}>
      {children}
    </Button>
  );
}