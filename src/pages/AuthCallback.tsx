import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/ios-supabase/client";

/**
 * OAuth return handler. Providers (Google/Apple) redirect back to this
 * route with either `?code=...` (PKCE) or `#access_token=...` (implicit).
 * We explicitly exchange the code for a session before letting the auth
 * guards decide where to send the user — this avoids a race where the
 * RequireAuth guard sees "no session yet" and bounces to /login before
 * supabase-js has finished hydrating the OAuth response.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const next = safeNext(params.get("next")) ?? "/select-vineyard";
    const errDesc = params.get("error_description") ?? params.get("error");

    if (errDesc) {
      setError(errDesc);
      return;
    }

    const run = async () => {
      try {
        const href = window.location.href;
        const hasCode = params.get("code");
        const hash = window.location.hash;
        const hashHasToken = hash.includes("access_token=");

        if (hasCode) {
          const { error } = await supabase.auth.exchangeCodeForSession(href);
          if (error) throw error;
        } else if (!hashHasToken) {
          // Nothing to exchange — maybe supabase-js already consumed it.
          // Fall through to session check.
        }

        // Wait briefly for onAuthStateChange to persist the session.
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          navigate(next, { replace: true });
        } else {
          // No session established — send to login rather than loop.
          navigate("/login", { replace: true });
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
  }, [navigate, params]);

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
  // Only accept same-origin relative paths.
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}
