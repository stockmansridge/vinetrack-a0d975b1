import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, XCircle, RefreshCw, KeyRound } from "lucide-react";
import { AdminGate, AdminPageHeader } from "./_shared";
import {
  runDiagnosticSend,
  fetchEmailDeliveryEvents,
  type DiagnosticSendResult,
  type DiagnosticTestName,
  type EmailDeliveryEvent,
  type NotificationTestExtras,
} from "@/lib/emailDiagnostics";
import { formatDate } from "@/lib/dateFormat";
import { supabase as iosSupabase } from "@/integrations/ios-supabase/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CardSpec {
  key: DiagnosticTestName;
  title: string;
  description: string;
  supportsNotificationExtras?: boolean;
}

const CARDS: CardSpec[] = [
  {
    key: "test-resend-email",
    title: "Resend provider test",
    description: "Confirms the Resend API key and sender domain are reachable from the VineTrack backend.",
  },
  {
    key: "test-invitation-email",
    title: "Invitation template test",
    description: "Sends a sample invitation email using the shared invitation template.",
  },
  {
    key: "test-support-staff-email",
    title: "Support staff notification test",
    description: "Sends the internal notification email that support staff receive for new requests.",
  },
  {
    key: "test-support-receipt-email",
    title: "Support receipt test",
    description: "Sends the confirmation email that submitters receive after opening a support request.",
  },
  {
    key: "test-notification-email",
    title: "Generic notification test",
    description: "Sends a generic VineTrack notification. Optional title, summary, and action link supported.",
    supportsNotificationExtras: true,
  },
];

function ResultPanel({ result }: { result: DiagnosticSendResult }) {
  if (result.success) {
    return (
      <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" />
          <div className="min-w-0">
            <div className="font-medium">Email submitted</div>
            <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
              {result.recipient_email && <div>Recipient: <span className="font-mono">{result.recipient_email}</span></div>}
              {result.provider && <div>Provider: {result.provider}</div>}
              {result.provider_message_id && (
                <div>Message ID: <span className="font-mono">{result.provider_message_id}</span></div>
              )}
              {result.submitted_at && <div>Submitted: {result.submitted_at}</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <div className="flex items-start gap-2">
        <XCircle className="h-4 w-4 text-destructive mt-0.5" />
        <div className="min-w-0">
          <div className="font-medium text-destructive">Test failed</div>
          <div className="text-sm mt-1">{result.message ?? "The test email could not be sent."}</div>
          {result.error_code && (
            <div className="text-xs text-muted-foreground mt-1">
              Code: <span className="font-mono">{result.error_code}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DiagnosticCard({ spec }: { spec: CardSpec }) {
  const [email, setEmail] = useState("");
  const [extras, setExtras] = useState<NotificationTestExtras>({
    title: "Test notification",
    summary: "This is a VineTrack email notification test.",
    notification_type: "information",
  });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<DiagnosticSendResult | null>(null);

  const trimmed = email.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 254 && EMAIL_RE.test(trimmed);
  const disabled = !valid || sending;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    setSending(true);
    setResult(null);
    try {
      const res = await runDiagnosticSend(
        spec.key,
        trimmed,
        spec.supportsNotificationExtras ? extras : undefined,
      );
      setResult(res);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-3">
        <h3 className="font-semibold">{spec.title}</h3>
        <p className="text-xs text-muted-foreground mt-1">{spec.description}</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor={`recipient-${spec.key}`} className="text-xs text-muted-foreground">
            Recipient email
          </Label>
          <Input
            id={`recipient-${spec.key}`}
            type="email"
            autoComplete="off"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            disabled={sending}
          />
        </div>
        {spec.supportsNotificationExtras && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <Label className="text-xs text-muted-foreground">Title</Label>
              <Input
                value={extras.title ?? ""}
                onChange={(e) => setExtras((s) => ({ ...s, title: e.target.value }))}
                disabled={sending}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Input
                value={extras.notification_type ?? ""}
                onChange={(e) => setExtras((s) => ({ ...s, notification_type: e.target.value }))}
                disabled={sending}
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs text-muted-foreground">Summary</Label>
              <Input
                value={extras.summary ?? ""}
                onChange={(e) => setExtras((s) => ({ ...s, summary: e.target.value }))}
                disabled={sending}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Action URL</Label>
              <Input
                value={extras.action_url ?? ""}
                onChange={(e) => setExtras((s) => ({ ...s, action_url: e.target.value }))}
                disabled={sending}
                placeholder="https://vinetrack.com.au"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Action label</Label>
              <Input
                value={extras.action_label ?? ""}
                onChange={(e) => setExtras((s) => ({ ...s, action_label: e.target.value }))}
                disabled={sending}
                placeholder="Visit VineTrack"
              />
            </div>
          </div>
        )}
        <Button type="submit" disabled={disabled}>
          {sending ? "Sending…" : "Send test"}
        </Button>
      </form>
      {result && <ResultPanel result={result} />}
    </Card>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const s = (status ?? "").toLowerCase();
  const variant: "default" | "secondary" | "destructive" | "outline" =
    s === "sent" || s === "delivered"
      ? "default"
      : s === "failed" || s === "bounced" || s === "error"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant}>{status ?? "—"}</Badge>;
}

function DeliveryHistory() {
  const [emailType, setEmailType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [detail, setDetail] = useState<EmailDeliveryEvent | null>(null);

  const q = useQuery({
    queryKey: ["email-delivery-events", emailType, status],
    queryFn: () =>
      fetchEmailDeliveryEvents({
        emailType: emailType === "all" ? null : emailType,
        status: status === "all" ? null : status,
        limit: 100,
      }),
    staleTime: 15_000,
  });

  const emailTypes = useMemo(() => {
    const set = new Set<string>();
    (q.data ?? []).forEach((r) => r.email_type && set.add(r.email_type));
    return Array.from(set).sort();
  }, [q.data]);

  const statuses = useMemo(() => {
    const set = new Set<string>();
    (q.data ?? []).forEach((r) => r.status && set.add(r.status));
    return Array.from(set).sort();
  }, [q.data]);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <h3 className="font-semibold">Delivery history</h3>
          <p className="text-xs text-muted-foreground">
            Latest 100 events from <span className="font-mono">email_delivery_events</span>.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <div className="w-40">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={emailType} onValueChange={setEmailType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {emailTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${q.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>
      {q.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm mb-3">
          Couldn't load delivery history: {(q.error as Error).message}
        </div>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Message ID</TableHead>
              <TableHead>Error</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-xs">{formatDate(row.created_at)}</TableCell>
                <TableCell className="text-xs">{row.email_type ?? "—"}</TableCell>
                <TableCell className="text-xs font-mono truncate max-w-[200px]">{row.recipient_email ?? "—"}</TableCell>
                <TableCell className="text-xs">{row.source_platform ?? "—"}</TableCell>
                <TableCell><StatusBadge status={row.status} /></TableCell>
                <TableCell className="text-xs">{row.provider ?? "—"}</TableCell>
                <TableCell className="text-xs font-mono truncate max-w-[180px]">{row.provider_message_id ?? "—"}</TableCell>
                <TableCell className="text-xs text-destructive">{row.error_code ?? ""}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => setDetail(row)}>Details</Button>
                </TableCell>
              </TableRow>
            ))}
            {!q.isLoading && (q.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-6">
                  No delivery events match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Delivery event</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">When</dt><dd>{formatDate(detail.created_at)}</dd>
                <dt className="text-muted-foreground">Type</dt><dd>{detail.email_type ?? "—"}</dd>
                <dt className="text-muted-foreground">Recipient</dt><dd className="font-mono break-all">{detail.recipient_email ?? "—"}</dd>
                <dt className="text-muted-foreground">Source</dt><dd>{detail.source_platform ?? "—"}</dd>
                <dt className="text-muted-foreground">Status</dt><dd>{detail.status ?? "—"}</dd>
                <dt className="text-muted-foreground">Provider</dt><dd>{detail.provider ?? "—"}</dd>
                <dt className="text-muted-foreground">Message ID</dt><dd className="font-mono break-all">{detail.provider_message_id ?? "—"}</dd>
                <dt className="text-muted-foreground">Error code</dt><dd>{detail.error_code ?? "—"}</dd>
              </dl>
              {detail.metadata && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Metadata (safe view — HTML and secrets excluded)</div>
                  <pre className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-64">
                    {JSON.stringify(sanitiseMetadata(detail.metadata), null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function sanitiseMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const REDACT_KEYS = /html|body|secret|token|api_key|apikey|password|authorization/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (REDACT_KEYS.test(k)) {
      out[k] = "[redacted]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = sanitiseMetadata(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export default function EmailDiagnosticsPage() {
  return (
    <AdminGate>
      <AdminPageHeader
        title="Email Diagnostics"
        subtitle="Test the unified VineTrack email pipeline and inspect delivery history."
      />
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {CARDS.map((spec) => <DiagnosticCard key={spec.key} spec={spec} />)}
        </div>
        <DeliveryHistory />
      </div>
    </AdminGate>
  );
}
