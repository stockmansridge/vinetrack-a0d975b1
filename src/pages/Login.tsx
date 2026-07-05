import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Mail, Lock } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";
import appIcon from "@/assets/vinetrack-app-icon.png";
import { BrandName } from "@/components/BrandName";
import { PageHead } from "@/components/PageHead";
import { PasswordToggleButton } from "@/components/ui/PasswordToggleButton";

export default function Login() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  if (loading) return <div className="p-8">Loading…</div>;
  if (session) return <Navigate to="/select-vineyard" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) toast({ title: "Sign in failed", description: error.message, variant: "destructive" });
  };

  const onReset = async () => {
    if (!email) {
      toast({ title: "Enter your email first", description: "Type your email above, then tap Forgot password.", variant: "destructive" });
      return;
    }
    setSendingReset(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSendingReset(false);
    if (error) {
      toast({ title: "Reset failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Reset email sent",
      description: "Check your inbox. Use the link, or enter the 6-digit code on the next page.",
    });
    navigate(`/reset-password?email=${encodeURIComponent(email)}`);
  };

  return (
    <>
      <PageHead
        title="Sign in to VineTrack"
        description="Sign in to the VineTrack vineyard management portal to manage blocks, spray records, work tasks and your team."
        path="/login"
      />
      <div
      className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, #0F6E33 0%, #054721 50%, #022C17 100%)",
      }}
    >
      {/* Soft top-left radial highlight */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(420px circle at 18% 12%, rgba(255,255,255,0.15), transparent 60%)",
        }}
      />

      <div className="relative w-full max-w-sm flex flex-col items-center gap-6">
        {/* Logo tile */}
        <div
          className="overflow-hidden bg-[#0B5128] ring-1 ring-white/25"
          style={{
            width: 102,
            height: 102,
            borderRadius: 26,
            boxShadow: "0 8px 14px rgba(0,0,0,0.35)",
          }}
        >
          <img src={appIcon} alt="VineTrack" className="h-full w-full object-cover" />
        </div>

        {/* Title + tagline */}
        <div className="text-center space-y-2">
          <h1
            className="text-white font-extrabold tracking-tight"
            style={{ fontSize: 40, lineHeight: 1.05, textShadow: "0 2px 2px rgba(0,0,0,0.28)" }}
          >
            <BrandName suffix="Portal" suffixClassName="text-white" className="text-white" />
          </h1>
          <p className="text-white/90 font-semibold text-[15px] leading-snug px-4">
            Management access for vineyard Owners and Managers.
          </p>
          <p className="text-white/85 font-medium text-[13px] leading-snug px-4">
            Sign in with the same account you use in the VineTrack iOS app.
          </p>
        </div>


        {/* Form card */}
        <form
          onSubmit={onSubmit}
          className="w-full bg-white/95 backdrop-blur-sm p-4 space-y-3"
          style={{
            borderRadius: 22,
            boxShadow: "0 10px 18px rgba(0,0,0,0.20)",
          }}
        >
          <FieldRow icon={<Mail className="h-4 w-4" style={{ color: "#055124" }} />}>
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-[#4D5C52]"
              style={{ color: "#03331A" }}
            />
          </FieldRow>
          <FieldRow icon={<Lock className="h-4 w-4" style={{ color: "#055124" }} />}>
            <input
              type={showPassword ? "text" : "password"}
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-[#4D5C52]"
              style={{ color: "#03331A" }}
              autoComplete="current-password"
            />
            <PasswordToggleButton visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />
          </FieldRow>

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 font-bold text-white disabled:opacity-60 transition-opacity"
            style={{
              background: "#007AFF",
              borderRadius: 15,
              boxShadow: "0 8px 14px rgba(0,0,0,0.22)",
            }}
          >
            {submitting ? "Signing in…" : "Sign In"}
          </button>

          <div className="flex items-center gap-3 pt-1">
            <div className="h-px flex-1 bg-black/10" />
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#4D5C52]">or</span>
            <div className="h-px flex-1 bg-black/10" />
          </div>

          <GoogleSignInButton redirectPath="/select-vineyard" />
        </form>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            disabled={sendingReset}
            className="text-sm font-medium hover:underline disabled:opacity-60"
            style={{ color: "#F0EBB8" }}
          >
            {sendingReset ? "Sending reset email…" : "Forgot password?"}
          </button>
          <a
            href="/signup"
            className="text-sm font-semibold hover:underline"
            style={{ color: "#FFFFFF" }}
          >
            Don't have an account? Create one
          </a>
        </div>
      </div>
    </div>
    </>
  );
}

function FieldRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-3 bg-white px-3"
      style={{
        minHeight: 48,
        borderRadius: 16,
        border: "1px solid rgba(60,60,67,0.18)",
      }}
    >
      <span
        className="inline-flex items-center justify-center"
        style={{ width: 32, height: 32, borderRadius: 10, background: "#EDF7E8" }}
      >
        {icon}
      </span>
      {children}
    </div>
  );
}
