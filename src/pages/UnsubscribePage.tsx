// Legacy landing page for unsubscribe links in older VineTrack emails.
//
// Unsubscribing is now handled by the managed email service itself (every
// email carries a one-click unsubscribe link in its footer / headers), so the
// old token-based backend endpoint no longer exists. This page therefore never
// calls a backend: it explains how to opt out and who to contact, instead of
// showing a dead-end error.
import { Mail } from "lucide-react";
import { PageHead } from "@/components/PageHead";

const SUPPORT_EMAIL = "support@vinetrack.com.au";

export default function UnsubscribePage() {
  return (
    <>
      <PageHead
        title="Unsubscribe from VineTrack emails"
        description="How to stop receiving notification emails from the VineTrack vineyard portal."
        path="/unsubscribe"
        noindex
      />
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
          <Mail className="mx-auto mb-3 h-6 w-6 text-muted-foreground" aria-hidden />
          <h1 className="mb-2 text-xl font-semibold">Unsubscribe</h1>
          <p className="mb-4 text-sm text-muted-foreground">
            VineTrack emails now include an unsubscribe link in the footer of the message
            itself. Open the most recent email you received and use the unsubscribe link
            there to stop receiving emails at that address straight away.
          </p>
          <p className="text-sm text-muted-foreground">
            Need a hand, or no longer have the email? Contact{" "}
            <a className="font-medium text-primary underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>{" "}
            and we'll remove you.
          </p>
        </div>
      </main>
    </>
  );
}
