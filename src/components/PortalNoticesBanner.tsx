import { useMemo, useState } from "react";
import { X, Megaphone, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  usePortalNotices,
  dismissalKey,
  markDismissed,
  readDismissed,
  type PortalNotice,
} from "@/lib/portalNotices";

const TONE_STYLES: Record<string, string> = {
  info: "border-primary/30 bg-primary/5",
  success: "border-emerald-500/30 bg-emerald-500/5",
  warning: "border-amber-500/40 bg-amber-500/5",
};

function ToneIcon({ tone }: { tone: string }) {
  if (tone === "success") return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />;
  if (tone === "warning") return <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />;
  return <Megaphone className="h-4 w-4 text-primary" aria-hidden />;
}

/** Announcements from the system admins, shown above all portal content. */
export default function PortalNoticesBanner() {
  const { data: notices = [] } = usePortalNotices();
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed());

  const visible = useMemo(
    () => notices.filter((n: PortalNotice) => !dismissed.includes(dismissalKey(n))),
    [notices, dismissed],
  );

  if (visible.length === 0) return null;

  const dismiss = (n: PortalNotice) => {
    const key = dismissalKey(n);
    markDismissed(key);
    setDismissed((prev) => [...prev, key]);
  };

  return (
    <div className="space-y-2 px-4 pt-3">
      {visible.map((n) => (
        <div
          key={n.id}
          role="status"
          className={`relative rounded-2xl border px-4 py-3 shadow-soft-sm ${
            TONE_STYLES[n.tone] ?? TONE_STYLES.info
          }`}
        >
          <div className="flex items-start gap-3 pr-9">
            <span className="mt-0.5 shrink-0">
              <ToneIcon tone={n.tone} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{n.title}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {n.message}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Dismiss notice: ${n.title}`}
            className="absolute right-2 top-2 h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
            onClick={() => dismiss(n)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
