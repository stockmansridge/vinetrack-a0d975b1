import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { AdminGate, AdminPageHeader } from "./_shared";
import { sendTestInvitationEmail, type TestEmailResult } from "@/lib/emailDiagnostics";
import { CheckCircle2, XCircle, Copy } from "lucide-react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailDiagnosticsPage() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TestEmailResult | null>(null);

  const trimmed = email.trim();
  const validEmail = trimmed.length > 0 && trimmed.length <= 254 && EMAIL_RE.test(trimmed);
  const disabled = !validEmail || sending;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    setSending(true);
    setResult(null);
    try {
      const res = await sendTestInvitationEmail(trimmed);
      setResult(res);
    } catch (err) {
      setResult({
        success: false,
        email_sent: false,
        error_code: "unexpected_error",
        message: err instanceof Error ? err.message : "Unexpected error sending test email.",
      });
    } finally {
      setSending(false);
    }
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast({ title: "Copied", description: "Provider message ID copied." });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <AdminGate>
      <AdminPageHeader
        title="Email Delivery Test"
        subtitle="Verify that Supabase Edge Functions and Resend are connected."
      />
      <div className="space-y-4 max-w-2xl">
        <Card className="p-5">
          <div className="mb-4">
            <h2 className="font-semibold">Send a test invitation-style email</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Send a test invitation-style email to confirm that Supabase and Resend are working
              correctly. This does not create an invitation or grant vineyard access.
            </p>
          </div>
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="test-recipient">
                Test recipient email
              </label>
              <Input
                id="test-recipient"
                type="email"
                autoComplete="off"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
              />
            </div>
            <Button type="submit" disabled={disabled}>
              {sending ? "Sending…" : "Send Test Email"}
            </Button>
          </form>
        </Card>

        {result && result.success && (
          <Card className="p-5 border-emerald-500/40 bg-emerald-500/10">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-emerald-900 dark:text-emerald-200">
                  Test email submitted successfully
                </div>
                <p className="text-sm mt-1">
                  Resend accepted the email for delivery to{" "}
                  <span className="font-mono">{result.recipient_email}</span>.
                </p>
                <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm mt-3">
                  <dt className="text-muted-foreground">Recipient</dt>
                  <dd className="font-mono truncate">{result.recipient_email}</dd>
                  <dt className="text-muted-foreground">Submitted</dt>
                  <dd className="font-mono">{result.submitted_at}</dd>
                  <dt className="text-muted-foreground">Provider</dt>
                  <dd>{result.provider}</dd>
                  <dt className="text-muted-foreground">Message ID</dt>
                  <dd className="flex items-center gap-2 min-w-0">
                    <span className="font-mono truncate">{result.provider_message_id ?? "—"}</span>
                    {result.provider_message_id && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => copyId(result.provider_message_id!)}
                        title="Copy message ID"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </dd>
                </dl>
                <p className="text-xs text-muted-foreground mt-3">
                  This confirms that Resend accepted the message. Final inbox delivery can be
                  checked in the Resend email logs.
                </p>
              </div>
            </div>
          </Card>
        )}

        {result && !result.success && (
          <Card className="p-5 border-destructive/40 bg-destructive/10">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 text-destructive mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-destructive">Test email could not be sent</div>
                <p className="text-sm mt-1">
                  {result.message ?? "The test email could not be sent."}
                </p>
                {result.error_code && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Code: <span className="font-mono">{result.error_code}</span>
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>
    </AdminGate>
  );
}
