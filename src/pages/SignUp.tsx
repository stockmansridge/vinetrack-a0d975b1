import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Mail, Lock, User as UserIcon } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";
import appIcon from "@/assets/vinetrack-app-icon.png";
import { BrandName } from "@/components/BrandName";
import { PageHead } from "@/components/PageHead";
import { PasswordToggleButton } from "@/components/ui/PasswordToggleButton";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";

export default function SignUp() {
  const { session, loading } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const navigate = useNavigate();

  if (loading) return <div className="p-8">Loading…</div>;
  if (session) return <Navigate to="/select-vineyard" replace />;

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
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: { full_name: name.trim() || null, display_name: name.trim() || null },
      },
    });
    setSubmitting(false);

    if (error) {
      const msg = /already|registered|exists/i.test(error.message)
        ? "An account already exists for this email. Please sign in instead."
        : error.message;
      toast({ title: "Couldn't create account", description: msg, variant: "destructive" });
      return;
    }

    // If email confirmation required, session will be null.
    if (!data.session) {
      setEmailSent(true);
      return;
    }

    // Seed the canonical profile row (Display Name = public.profiles.full_name).
    // Safe if a DB trigger already inserted a row: upsert on the user id.
    if (data.user) {
      await (supabase as any)
        .from("profiles")
        .upsert(
          {
            id: data.user.id,
            email: data.user.email ?? email.trim(),
            full_name: name.trim() || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" },
        );
    }

    toast({ title: "Account created", description: "Let's set up your first vineyard." });
    navigate("/onboarding", { replace: true });

  };

  return (
    <>
      <PageHead
        title="Create your VineTrack account"
        description="Sign up for the VineTrack vineyard management portal."
        path="/signup"
      />
      <div
        className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, #0F6E33 0%, #054721 50%, #022C17 100%)",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(420px circle at 18% 12%, rgba(255,255,255,0.15), transparent 60%)",
          }}
        />

        <div className="relative w-full max-w-sm flex flex-col items-center gap-6 py-8">
          <div
            className="overflow-hidden bg-[#0B5128] ring-1 ring-white/25"
            style={{
              width: 88,
              height: 88,
              borderRadius: 22,
              boxShadow: "0 8px 14px rgba(0,0,0,0.35)",
            }}
          >
            <img src={appIcon} alt="VineTrack" className="h-full w-full object-cover" />
          </div>

          <div className="text-center space-y-2">
            <h1
              className="text-white font-extrabold tracking-tight"
              style={{ fontSize: 32, lineHeight: 1.1, textShadow: "0 2px 2px rgba(0,0,0,0.28)" }}
            >
              Create your <BrandName className="text-white" /> account
            </h1>
            <p className="text-white/90 font-semibold text-[14px] leading-snug px-4">
              Set up your vineyard portal and connect your in-field records.
            </p>
          </div>

          {emailSent ? (
            <div
              className="w-full bg-[#FFFDF2] p-5 text-center ring-1 ring-black/5 space-y-3"
              style={{ borderRadius: 18, boxShadow: "0 6px 12px rgba(0,0,0,0.18)" }}
            >
              <p className="text-[15px] font-semibold" style={{ color: "#03331A" }}>
                Check your email
              </p>
              <p className="text-[13px]" style={{ color: "#3B4A40" }}>
                We've sent a confirmation link to <strong>{email}</strong>. Click the link to
                activate your account, then sign in.
              </p>
              <Link
                to="/login"
                className="inline-block w-full h-11 leading-[44px] font-bold text-white"
                style={{ background: "#85B830", borderRadius: 13 }}
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form
              onSubmit={onSubmit}
              className="w-full bg-white/95 backdrop-blur-sm p-4 space-y-3"
              style={{ borderRadius: 22, boxShadow: "0 10px 18px rgba(0,0,0,0.20)" }}
            >
              <FieldRow icon={<UserIcon className="h-4 w-4" style={{ color: "#055124" }} />}>
                <input
                  type="text"
                  required
                  placeholder="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-[#4D5C52]"
                  style={{ color: "#03331A" }}
                />
              </FieldRow>
              <FieldRow icon={<Mail className="h-4 w-4" style={{ color: "#055124" }} />}>
                <input
                  type="email"
                  required
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={255}
                  className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-[#4D5C52]"
                  style={{ color: "#03331A" }}
                />
              </FieldRow>
              <FieldRow icon={<Lock className="h-4 w-4" style={{ color: "#055124" }} />}>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="Password (min 8 chars)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-[#4D5C52]"
                  style={{ color: "#03331A" }}
                  autoComplete="new-password"
                />
                <PasswordToggleButton visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />
              </FieldRow>
              <FieldRow icon={<Lock className="h-4 w-4" style={{ color: "#055124" }} />}>
                <input
                  type={showConfirm ? "text" : "password"}
                  required
                  placeholder="Confirm password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  minLength={8}
                  className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-[#4D5C52]"
                  style={{ color: "#03331A" }}
                  autoComplete="new-password"
                />
                <PasswordToggleButton visible={showConfirm} onToggle={() => setShowConfirm((v) => !v)} />
              </FieldRow>

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-12 font-bold text-white disabled:opacity-60 transition-opacity"
                style={{
                  background: "#85B830",
                  borderRadius: 15,
                  boxShadow: "0 8px 14px rgba(0,0,0,0.22)",
                }}
              >
                {submitting ? "Creating account…" : "Create account"}
              </button>
            </form>
          )}

          <Link to="/login" className="text-sm font-medium hover:underline" style={{ color: "#F0EBB8" }}>
            Already have an account? Sign in
          </Link>
        </div>
      </div>
    </>
  );
}

function FieldRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-3 bg-white px-3"
      style={{ minHeight: 48, borderRadius: 16, border: "1px solid rgba(60,60,67,0.18)" }}
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
