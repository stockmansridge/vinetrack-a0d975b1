import { useState } from "react";
import { supabase } from "@/integrations/ios-supabase/client";
import { toast } from "@/hooks/use-toast";

interface Props {
  label?: string;
  /** Same-origin path to return to after Apple completes. Defaults to origin root. */
  redirectPath?: string;
}

/**
 * "Continue with Apple" — Supabase OAuth against the iOS Supabase project
 * (the portal's source of truth for auth). The Apple provider must be
 * enabled on that Supabase project, with portal origins in the Redirect
 * URLs allow-list and the Supabase callback registered in the Apple
 * Services ID configuration. On success the AuthContext session listener
 * picks up the new session and the app routes normally.
 *
 * Apple private-relay note: users who choose "Hide My Email" arrive with
 * a @privaterelay.appleid.com address. Same-email identity linking will
 * NOT match a pre-existing account whose email is the user's real
 * address — Apple sign-in creates a new auth.users row in that case,
 * and `handle_new_user_profile` bootstraps a fresh profile row.
 */
export function AppleSignInButton({ label = "Continue with Apple", redirectPath = "/" }: Props) {
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    setLoading(true);
    const redirectTo = `${window.location.origin}${redirectPath}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: { redirectTo },
    });
    if (error) {
      setLoading(false);
      toast({
        title: "Apple sign-in failed",
        description: error.message,
        variant: "destructive",
      });
    }
    // On success the browser redirects to Apple; no further work here.
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="w-full h-12 flex items-center justify-center gap-3 font-semibold disabled:opacity-60 transition-opacity"
      style={{
        color: "#FFFFFF",
        background: "#000000",
        borderRadius: 15,
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 8px 14px rgba(0,0,0,0.22)",
      }}
      aria-label={label}
    >
      <AppleGlyph />
      <span className="text-[15px]">{loading ? "Opening Apple…" : label}</span>
    </button>
  );
}

function AppleGlyph() {
  return (
    <svg width="16" height="18" viewBox="0 0 384 512" aria-hidden="true" fill="#FFFFFF">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zM256.7 84.8c17.9-21.5 27.6-50.4 22.9-77.8-25 3.9-54.2 19.6-71.7 41.1-15.7 19.1-27.4 47.3-24.5 74 27.4 1.8 51.4-13.4 73.3-37.3z"/>
    </svg>
  );
}
