import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { toast } from "@/hooks/use-toast";
import appIcon from "@/assets/vinetrack-app-icon.png";
import { PageHead } from "@/components/PageHead";
import { PasswordToggleButton } from "@/components/ui/PasswordToggleButton";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Supabase puts ?code=... in the query (PKCE) or #access_token=...&type=recovery in the hash.
  // exchangeCodeForSession handles the query-string code; the hash flow is handled by the SDK
  // automatically via detectSessionInUrl, leaving us with an authenticated session we can update.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          // Clean the code out of the URL
          url.searchParams.delete("code");
          window.history.replaceState({}, "", url.pathname + url.search + url.hash);
        }
        const { data } = await supabase.auth.getSession();
        if (!cancelled) {
          setHasRecoverySession(!!data.session);
          setReady(true);
        }
      } catch (err: any) {
        if (!cancelled) {
          setReady(true);
          setHasRecoverySession(false);
          toast({
            title: "Reset link invalid or expired",
            description: err?.message ?? "Please request a new password reset email.",
            variant: "destructive",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      toast({ title: "Couldn't update password", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Password updated", description: "You're now signed in." });
    navigate("/select-vineyard", { replace: true });
  };

  return (
    <>
      <PageHead title="Set a new password" description="Set a new password for your VineTrack account." path="/reset-password" />
      <div
        className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0F6E33 0%, #054721 50%, #022C17 100%)" }}
      >
        <div className="relative w-full max-w-sm flex flex-col items-center gap-6">
          <div
            className="overflow-hidden bg-[#0B5128] ring-1 ring-white/25"
            style={{ width: 102, height: 102, borderRadius: 26, boxShadow: "0 8px 14px rgba(0,0,0,0.35)" }}
          >
            <img src={appIcon} alt="VineTrack" className="h-full w-full object-cover" />
          </div>

          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold text-white">Set a new password</h1>
            <p className="text-sm text-white/70">Choose a strong password you haven't used before.</p>
          </div>

          {!ready ? (
            <p className="text-white/80 text-sm">Loading…</p>
          ) : !hasRecoverySession ? (
            <div className="w-full rounded-2xl bg-white/95 p-5 text-sm text-center space-y-3">
              <p>This reset link is invalid or has expired.</p>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="text-[#0F6E33] font-medium underline"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="w-full space-y-3">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="New password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl bg-white/95 pl-9 pr-10 py-3 text-sm outline-none"
                  autoComplete="new-password"
                />
                <PasswordToggleButton
                  visible={showPassword}
                  onToggle={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
                <input
                  type={showConfirm ? "text" : "password"}
                  required
                  placeholder="Confirm new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-xl bg-white/95 pl-9 pr-10 py-3 text-sm outline-none"
                  autoComplete="new-password"
                />
                <PasswordToggleButton
                  visible={showConfirm}
                  onToggle={() => setShowConfirm((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-white py-3 text-sm font-medium text-[#0F6E33] disabled:opacity-60"
              >
                {submitting ? "Updating…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
