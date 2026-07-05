import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/ios-supabase/client";

/**
 * OAuth return handler for Google/Apple PKCE flows.
 *
 * Supabase JS v2 `exchangeCodeForSession` takes the raw `code` string,
 * NOT the full callback URL. Passing the href produced
 * "Unable to exchange external code: <prefix>" for Apple.
 *
 * We also guard against React StrictMode double-invoke and any accidental
 * re-run: auth codes are single-use, so a second exchange with the same
 * code always fails. `ranRef` ensures the exchange runs exactly once
 * per page load.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const ranRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;

    const run = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const nextParam = url.searchParams.get("next");
      const next = safeNext(nextParam) ?? "/select-vineyard";
      const oauthError = url.searchParams.get("error");
      const oauthErrorDescription =
        url.searchParams.get("error_description") ?? url.searchParams.get("error");

      if (oauthError) {
        setError(oauthErrorDescription ?? "Sign-in was cancelled or failed.");
        return;
      }

      // Implicit flow (hash tokens) — supabase-js handles this itself once
      // we call getSession(). Nothing to exchange.
      const hashHasToken = window.location.hash.includes("access_token=");

      try {
        if (code) {
          // Pass ONLY the code string — v2 signature is (authCode: string).
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (!hashHasToken) {
          setError("Sign-in link is missing its authorisation code. Please try again.");
          return;
        }

        const { data } = await supabase.auth.getSession();
        if (cancelled) return;

        if (data.session) {
          navigate(next, { replace: true });
        } else {
          setError("Sign-in didn't create a session. Please try again.");
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Sign-in failed");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-lg font-semibold">Sign-in didn't complete</h1>
          <p className="text-sm text-muted-foreground break-words">{error}</p>
          <button
            className="text-sm underline"
            onClick={() => navigate("/login", { replace: true })}
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return <div className="p-8 text-muted-foreground">Finishing sign-in…</div>;
}

function safeNext(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}
