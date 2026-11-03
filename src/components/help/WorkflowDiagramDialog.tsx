// Workflow diagram help — presentation only.
//
// A small help control beside a page heading that opens a large dialog
// showing an illustrated workflow diagram. Same sizing and behaviour as the
// irrigation mapping / MAIT setup guides: 96vw dialog, scrollable image,
// "Open full size in new tab" link. Holds no state beyond open/closed.
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface WorkflowDiagramDialogProps {
  /** Visible trigger label, e.g. "How the workflow fits together". */
  triggerLabel: string;
  /** Accessible name for the trigger button. */
  ariaLabel: string;
  /** Dialog heading. */
  title: string;
  /** One-line summary under the heading. */
  description: string;
  /** CDN URL of the diagram image. */
  imageUrl: string;
  /** Full alt text describing the diagram for screen readers. */
  imageAlt: string;
  /** Small print shown at the bottom-left of the dialog. */
  footnote: string;
}

export default function WorkflowDiagramDialog({
  triggerLabel,
  ariaLabel,
  title,
  description,
  imageUrl,
  imageAlt,
  footnote,
}: WorkflowDiagramDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" aria-label={ariaLabel}>
          <CircleHelp className="h-4 w-4" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[96vw] max-w-[1400px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(96vh-13rem)] overflow-y-auto rounded-md border border-border">
          <img src={imageUrl} alt={imageAlt} className="w-full h-auto" loading="lazy" />
        </div>
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">{footnote}</p>
          <a
            href={imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Open full size in new tab
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
