import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Eye, Send, Monitor, Smartphone, Loader2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import {
  GALLERY_TEMPLATES,
  VISUAL_CHECKLIST,
  fetchTemplatePreview,
  type GalleryTemplate,
  type TemplatePreviewResult,
} from "@/lib/emailTemplateGallery";
import { runDiagnosticSend, type DiagnosticSendResult } from "@/lib/emailDiagnostics";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Device = "desktop" | "mobile";

function PreviewFrame({
  html,
  device,
  forcedDark,
}: {
  html: string;
  device: Device;
  forcedDark: boolean;
}) {
  const width = device === "desktop" ? 640 : 375;
  const doc = `<!doctype html><html><head><meta name="viewport" content="width=${width}, initial-scale=1">
<meta name="color-scheme" content="${forcedDark ? "dark" : "light"}">
<style>html,body{margin:0;padding:0;}body{background:${forcedDark ? "#111311" : "#f4f4f5"};}
.vt-preview-shell{max-width:${width}px;margin:0 auto;overflow-x:hidden;}</style></head>
<body><div class="vt-preview-shell">${html}</div></body></html>`;
  return (
    <div className="flex justify-center bg-muted/40 p-4 rounded-md overflow-x-auto">
      <iframe
        title="Email preview"
        sandbox=""
        srcDoc={doc}
        style={{ width, height: 720, border: "1px solid hsl(var(--border))", background: "#fff" }}
      />
    </div>
  );
}

function PreviewDialog({
  template,
  onClose,
}: {
  template: GalleryTemplate;
  onClose: () => void;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const [forcedDark, setForcedDark] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const preview = useMutation<TemplatePreviewResult>({
    mutationFn: () => fetchTemplatePreview(template),
  });

  // Kick off on first render.
  if (preview.isIdle) preview.mutate();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          <DialogDescription>
            {template.purpose} Preview values are samples — no real recovery token or confirmation URL is
            shown.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={device === "desktop" ? "default" : "outline"}
            size="sm"
            onClick={() => setDevice("desktop")}
          >
            <Monitor className="h-4 w-4 mr-1" /> Desktop 640px
          </Button>
          <Button
            variant={device === "mobile" ? "default" : "outline"}
            size="sm"
            onClick={() => setDevice("mobile")}
          >
            <Smartphone className="h-4 w-4 mr-1" /> Mobile 375px
          </Button>
          <Button
            variant={forcedDark ? "default" : "outline"}
            size="sm"
            onClick={() => setForcedDark((v) => !v)}
          >
            Forced dark
          </Button>
          <Button variant="ghost" size="sm" onClick={() => preview.mutate()} disabled={preview.isPending}>
            {preview.isPending ? "Loading…" : "Reload preview"}
          </Button>
        </div>

        <div className="text-xs text-muted-foreground space-y-0.5">
          <div>Sender: <span className="font-mono">{template.sender}</span></div>
          <div>Subject: {preview.data?.subject ?? template.subject}</div>
          {preview.data?.source && <div>Rendered by backend endpoint: <span className="font-mono">{preview.data.source}</span></div>}
        </div>

        {preview.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Requesting preview from the backend…
          </div>
        )}

        {!preview.isPending && preview.data?.status === "ready" && preview.data.html && (
          <PreviewFrame html={preview.data.html} device={device} forcedDark={forcedDark} />
        )}

        {!preview.isPending && preview.data && preview.data.status !== "ready" && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600" />
              <div>
                <div className="font-medium">Backend preview not available</div>
                <div className="mt-1 text-muted-foreground">{preview.data.message}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  The portal deliberately does not reproduce template HTML — the backend stays the source of
                  truth.
                </div>
              </div>
            </div>
          </div>
        )}

        <div>
          <div className="text-sm font-medium mb-2">Visual validation checklist</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {VISUAL_CHECKLIST.map((item) => (
              <label key={item} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={!!checked[item]}
                  onCheckedChange={(v) => setChecked((s) => ({ ...s, [item]: v === true }))}
                />
                <span className={checked[item] ? "text-muted-foreground line-through" : ""}>{item}</span>
              </label>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SendTestDialog({
  template,
  onClose,
}: {
  template: GalleryTemplate;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<DiagnosticSendResult | null>(null);
  const trimmed = email.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 254 && EMAIL_RE.test(trimmed);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || sending || !template.test) return;
    setSending(true);
    setResult(null);
    try {
      setResult(await runDiagnosticSend(template.test, trimmed, template.testExtras));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send test — {template.name}</DialogTitle>
          <DialogDescription>
            Sends a real email through the VineTrack backend using the production template.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor={`gallery-test-${template.key}`} className="text-xs text-muted-foreground">
              Recipient email
            </Label>
            <Input
              id={`gallery-test-${template.key}`}
              type="email"
              autoComplete="off"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              disabled={sending}
            />
          </div>
          <Button type="submit" disabled={!valid || sending}>
            {sending ? "Sending…" : "Send test"}
          </Button>
        </form>
        {result && (
          <div
            className={
              "rounded-md border p-3 text-sm " +
              (result.success
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-destructive/40 bg-destructive/10")
            }
          >
            <div className="flex items-start gap-2">
              {result.success ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="font-medium">{result.success ? "Email submitted" : "Test failed"}</div>
                {!result.success && (
                  <div className="mt-1">{result.message ?? "The test email could not be sent."}</div>
                )}
                {result.success && result.provider_message_id && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Message ID: <span className="font-mono">{result.provider_message_id}</span>
                  </div>
                )}
                {result.error_code && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Code: <span className="font-mono">{result.error_code}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function EmailTemplateGallery() {
  const [previewing, setPreviewing] = useState<GalleryTemplate | null>(null);
  const [testing, setTesting] = useState<GalleryTemplate | null>(null);

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h3 className="font-semibold">Email Template Gallery</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Preview the production visual design of every VineTrack email. Previews are rendered by the
          backend with sample values — real recovery tokens and confirmation URLs are never shown.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {GALLERY_TEMPLATES.map((t) => (
          <div key={t.key} className="rounded-md border p-4">
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-medium">{t.name}</h4>
              <Badge variant={t.source === "auth" ? "secondary" : "outline"}>
                {t.source === "auth" ? "Auth template" : "App template"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{t.purpose}</p>
            <dl className="mt-2 text-xs text-muted-foreground space-y-0.5">
              <div>Sender: <span className="font-mono">{t.sender}</span></div>
              <div>Subject: {t.subject}</div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setPreviewing(t)}>
                <Eye className="h-4 w-4 mr-1" /> Preview
              </Button>
              {t.test && (
                <Button variant="ghost" size="sm" onClick={() => setTesting(t)}>
                  <Send className="h-4 w-4 mr-1" /> Send test
                </Button>
              )}
            </div>
            {t.testNote && <p className="text-[11px] text-muted-foreground mt-2">{t.testNote}</p>}
          </div>
        ))}
      </div>

      {previewing && <PreviewDialog template={previewing} onClose={() => setPreviewing(null)} />}
      {testing && <SendTestDialog template={testing} onClose={() => setTesting(null)} />}
    </Card>
  );
}
