// CSV of a newsletter send's recipients (sent / failed / suppressed / pending).
import { supabase as functionsHost } from "@/integrations/supabase/client";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import { csvCell } from "@/lib/emailListAdmin";

export interface NewsletterRecipientRow {
  email: string;
  source: string | null;
  status: string;
  error_message: string | null;
  sent_at: string | null;
}

export function buildNewsletterRecipientsCsv(rows: NewsletterRecipientRow[]): string {
  const lines = ["Email,Status,Source,Sent At,Error"];
  for (const r of rows) {
    lines.push(
      [r.email, r.status, r.source, r.sent_at, r.error_message].map((v) => csvCell(v ?? "")).join(","),
    );
  }
  return lines.join("\r\n");
}

export async function downloadNewsletterRecipientsCsv(versionId: string, name: string) {
  const { data: s } = await iosSupabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) throw new Error("Your session has expired — please sign in again.");
  const { data, error } = await functionsHost.functions.invoke("admin-newsletters", {
    body: { action: "recipients", version_id: versionId },
    headers: { "x-vinetrack-token": token },
  });
  if (error) throw new Error(error.message ?? "Export failed");
  const rows = ((data as { recipients?: NewsletterRecipientRow[] })?.recipients ?? []);
  const blob = new Blob(["\uFEFF", buildNewsletterRecipientsCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "newsletter"}-recipients.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
