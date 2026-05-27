import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, Mail, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { toast } from "@/hooks/use-toast";
import appIcon from "@/assets/vinetrack-app-icon.png";
import { PageHead } from "@/components/PageHead";
import { PasswordToggleButton } from "@/components/ui/PasswordToggleButton";

type Mode = "loading" | "session" | "otp";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("loading");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendingNew, setSendingNew] = useState(false);

  // Try to consume any recovery link in the URL (PKCE ?code=... or hash #access_token=...&type=recovery).
  // If we end up with a session, switch to "session" mode (password-only form).
  // Otherwise fall back to manual OTP entry.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = new URL(window.location.href);
        const codeParam = url.searchParams.get("code");
        const prefillEmail = url.searchParams.get("email");
        if (prefillEmail) setEmail(prefillEmail);
        if (codeParam) {
          const { error } = await supabase.auth.exchangeCodeForSession(codeParam);
          if (error) throw error;
          url.searchParams.delete("code");
          window.history.replaceState({}, "", url.pathname + url.search + url.hash);
        }
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        setMode(data.session ? "session" : "otp");
      } catch (err: any) {
        if (cancelled) return;
        setMode("otp");
        toast({
          title: "Reset link couldn't be used",
          description: err?.message ?? "Enter the 6-digit code from the reset email below.",
          variant: "destructive",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const validatePasswords = () => {
    if (password.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return false;
    }
    if (password !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return false;
    }
    return true;
  };

  const onSubmitSession = async (e: FormEvent) => {
    e.preventDefault();
    if (!validatePasswords()) return;
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      toast({ title: "Couldn't update password", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Password updated successfully", description: "You're now signed in." });
    navigate("/select-vineyard", { replace: true });
  };

  const onSubmitOtp = async (e: FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast({ title: "Enter your email", variant: "destructive" });
      return;
    }
    if (!code || code.trim().length < 6) {
      toast({ title: "Enter the 6-digit code from the email", variant: "destructive" });
      return;
    }
    if (!validatePasswords()) return;
    setSubmitting(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "recovery",
    });
    if (verifyError) {
      setSubmitting(false);
      toast({
        title: "Invalid or expired code",
        description: verifyError.message,
        variant: "destructive",
      });
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      toast({ title: "Couldn't update password", description: updateError.message, variant: "destructive" });
      return;
    }
    toast({ title: "Password updated successfully", description: "You're now signed in." });
    navigate("/select-vineyard", { replace: true });
  };

  const onResendCode = async () => {
    if (!email) {
      toast({ title: "Enter your email first", variant: "destructive" });
      return;
    }
    setSendingNew(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSendingNew(false);
    if (error) {
      toast({ title: "Couldn't send reset email", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Reset email sent", description: "Check your inbox for the code or link." });
  };

  return (
    <>
      <PageHead
        title="Set a new password"
        description="Set a new password for your VineTrack account."
        path="/reset-password"
      />
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
            <p className="text-sm text-white/80">
              {mode === "session"
                ? "Choose a strong password you haven't used before."
                : "Enter the code from your reset email and your new password."}
            </p>
          </div>

          {mode === "loading" ? (
            <p className="text-white/80 text-sm">Loading…</p>
          ) : mode === "session" ? (
            <form onSubmit={onSubmitSession} className="w-full space-y-3">
              <PasswordField
                placeholder="New password"
                value={password}
                onChange={setPassword}
                visible={showPassword}
                onToggle={() => setShowPassword((v) => !v)}
              />
              <PasswordField
                placeholder="Confirm new password"
                value={confirm}
                onChange={setConfirm}
                visible={showConfirm}
                onToggle={() => setShowConfirm((v) => !v)}
              />
              <SubmitButton submitting={submitting} label="Update password" />
            </form>
          ) : (
            <form onSubmit={onSubmitOtp} className="w-full space-y-3">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
                <input
                  type="email"
                  required
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl bg-white/95 pl-9 pr-3 py-3 text-sm outline-none"
                  autoComplete="email"
                />
              </div>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  placeholder="6-digit reset code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\s+/g, ""))}
                  className="w-full rounded-xl bg-white/95 pl-9 pr-3 py-3 text-sm outline-none tracking-widest"
                />
              </div>
              <PasswordField
                placeholder="New password"
                value={password}
                onChange={setPassword}
                visible={showPassword}
                onToggle={() => setShowPassword((v) => !v)}
              />
              <PasswordField
                placeholder="Confirm new password"
                value={confirm}
                onChange={setConfirm}
                visible={showConfirm}
                onToggle={() => setShowConfirm((v) => !v)}
              />
              <SubmitButton submitting={submitting} label="Reset password" />
              <div className="flex items-center justify-between text-xs text-white/85 pt-1">
                <button
                  type="button"
                  onClick={onResendCode}
                  disabled={sendingNew}
                  className="underline disabled:opacity-60"
                >
                  {sendingNew ? "Sending…" : "Resend reset email"}
                </button>
                <button type="button" onClick={() => navigate("/login")} className="underline">
                  Back to sign in
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

function PasswordField({
  placeholder,
  value,
  onChange,
  visible,
  onToggle,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
      <input
        type={visible ? "text" : "password"}
        required
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl bg-white/95 pl-9 pr-10 py-3 text-sm outline-none"
        autoComplete="new-password"
      />
      <PasswordToggleButton
        visible={visible}
        onToggle={onToggle}
        className="absolute right-2 top-1/2 -translate-y-1/2"
      />
    </div>
  );
}

function SubmitButton({ submitting, label }: { submitting: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={submitting}
      className="w-full rounded-xl bg-white py-3 text-sm font-medium text-[#0F6E33] disabled:opacity-60"
    >
      {submitting ? "Updating…" : label}
    </button>
  );
}
