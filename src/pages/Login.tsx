import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { Mail, Lock } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";
import appIcon from "@/assets/vinetrack-app-icon.png";

export default function Login() {
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
      toast({ title: "Enter your email first", variant: "destructive" });
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    if (error) toast({ title: "Reset failed", description: error.message, variant: "destructive" });
    else toast({ title: "Password reset email sent" });
  };

  return (
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
            style={{ fontSize: 44, lineHeight: 1, textShadow: "0 2px 2px rgba(0,0,0,0.28)" }}
          >
            VineTrack Portal
          </h1>
          <p className="text-white/90 font-medium text-base leading-snug px-4">
            Sign in with the same account you use
            <br />
            in the VineTrack iOS app.
          </p>
        </div>

        {/* Info message */}
        <div
          className="w-full rounded-2xl border border-white/25 bg-white/10 backdrop-blur-sm px-4 py-3 text-center"
          style={{ borderRadius: 16 }}
        >
          <p className="text-white text-[13px] font-semibold leading-snug">
            Accounts are created in the VineTrack app. Portal access is available to vineyard
            Owners and Managers only.
          </p>
          <p className="mt-1.5 text-white/80 text-[11px] leading-snug">
            Operators can continue using the VineTrack app, but portal access is restricted to
            management roles.
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
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-[#4D5C52]"
              style={{ color: "#03331A" }}
            />
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
        </form>

        <button
          type="button"
          onClick={onReset}
          className="text-sm font-medium hover:underline"
          style={{ color: "#F0EBB8" }}
        >
          Forgot password?
        </button>
      </div>
    </div>
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
