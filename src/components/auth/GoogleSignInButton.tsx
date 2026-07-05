import { useState } from "react";
import { supabase } from "@/integrations/ios-supabase/client";
import { toast } from "@/hooks/use-toast";

interface Props {
  label?: string;
  /** Same-origin path to return to after Google completes. Defaults to origin root. */
  redirectPath?: string;
}

/**
 * "Continue with Google" — Supabase OAuth against the iOS Supabase project
 * (the portal's source of truth for auth). The Google provider must be
 * enabled on that Supabase project and the portal origins added to the
 * project's Redirect URLs allow-list. On success the AuthContext session
 * listener picks up the new session and the app routes normally.
 */
export function GoogleSignInButton({ label = "Continue with Google", redirectPath = "/" }: Props) {
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    setLoading(true);
    const redirectTo = `${window.location.origin}${redirectPath}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setLoading(false);
      toast({
        title: "Google sign-in failed",
        description: error.message,
        variant: "destructive",
      });
    }
    // On success the browser redirects to Google; no further work here.
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="w-full h-12 flex items-center justify-center gap-3 font-semibold bg-white disabled:opacity-60 transition-opacity"
      style={{
        color: "#1F1F1F",
        borderRadius: 15,
        border: "1px solid rgba(0,0,0,0.12)",
        boxShadow: "0 8px 14px rgba(0,0,0,0.18)",
      }}
      aria-label={label}
    >
      <GoogleGlyph />
      <span className="text-[15px]">{loading ? "Opening Google…" : label}</span>
    </button>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      <path fill="none" d="M0 0h48v48H0z"/>
    </svg>
  );
}
