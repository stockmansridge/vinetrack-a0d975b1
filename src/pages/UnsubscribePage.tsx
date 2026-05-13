import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { PageHead } from "@/components/PageHead";

type State =
  | { phase: "validating" }
  | { phase: "ready"; token: string }
  | { phase: "submitting"; token: string }
  | { phase: "success" }
  | { phase: "already" }
  | { phase: "error"; message: string };

export default function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>({ phase: "validating" });

  useEffect(() => {
    if (!token) {
      setState({ phase: "error", message: "Missing unsubscribe token." });
      return;
    }
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`;
    fetch(url, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setState({
            phase: "error",
            message: data?.error ?? "This unsubscribe link is invalid or expired.",
          });
          return;
        }
        if (data?.valid === false && data?.reason === "already_unsubscribed") {
          setState({ phase: "already" });
          return;
        }
        setState({ phase: "ready", token });
      })
      .catch(() =>
        setState({ phase: "error", message: "Could not reach the server." }),
      );
  }, [token]);

  const confirm = async () => {
    if (state.phase !== "ready") return;
    setState({ phase: "submitting", token: state.token });
    const { data, error } = await supabase.functions.invoke(
      "handle-email-unsubscribe",
      { body: { token: state.token } },
    );
    if (error) {
      setState({ phase: "error", message: error.message });
      return;
    }
    const result = data as { success?: boolean; reason?: string };
    if (result?.success) setState({ phase: "success" });
    else if (result?.reason === "already_unsubscribed")
      setState({ phase: "already" });
    else setState({ phase: "error", message: "Could not unsubscribe." });
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm text-center">
        <h1 className="text-xl font-semibold mb-2">Unsubscribe</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Manage email notifications from VineTrack.
        </p>

        {state.phase === "validating" && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking link…
          </div>
        )}

        {state.phase === "ready" && (
          <>
            <p className="mb-6 text-sm">
              Click below to confirm you want to stop receiving emails at this address.
            </p>
            <Button onClick={confirm} className="w-full">
              Confirm unsubscribe
            </Button>
          </>
        )}

        {state.phase === "submitting" && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Processing…
          </div>
        )}

        {state.phase === "success" && (
          <div className="flex flex-col items-center gap-2 text-green-600">
            <CheckCircle2 className="h-6 w-6" />
            <p className="text-sm">You've been unsubscribed.</p>
          </div>
        )}

        {state.phase === "already" && (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="h-6 w-6" />
            <p className="text-sm">You're already unsubscribed.</p>
          </div>
        )}

        {state.phase === "error" && (
          <div className="flex flex-col items-center gap-2 text-destructive">
            <AlertCircle className="h-6 w-6" />
            <p className="text-sm">{state.message}</p>
          </div>
        )}
      </div>
    </main>
  );
}
