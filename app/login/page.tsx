"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Database, Shield, Zap, Globe } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const FEATURES = [
  { icon: Shield, text: "GDPR-aware data pipeline" },
  { icon: Zap,    text: "Real-time scraping queue" },
  { icon: Globe,  text: "Instagram & TikTok coverage" },
];

const inputCls =
  "w-full px-3 py-2.5 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export default function LoginPage() {
  const router = useRouter();
  const [justCreated, setJustCreated] = useState(false);
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [resetMsg, setResetMsg] = useState("");
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("created") === "1") setJustCreated(true);
    if (p.get("reset")   === "1") setResetMsg("Password updated — sign in with your new password.");
    if (p.get("deleted") === "1") setResetMsg("Your account has been deleted.");
  }, []);

  async function handleForgotPassword() {
    setError("");
    setResetMsg("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter your email above first, then click “Forgot password”.");
      return;
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    if (!url.startsWith("https://")) {
      setError("App is not configured: Supabase credentials are missing.");
      return;
    }
    setResetting(true);
    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) { setError(resetError.message || "Could not send reset email."); return; }
      setResetMsg(`If an account exists for ${email.trim()}, a password-reset link is on its way. Check your inbox.`);
    } catch {
      setError("Network error — could not send reset email.");
    } finally {
      setResetting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    if (!url.startsWith("https://")) {
      setError("App is not configured: Supabase credentials are missing or invalid. Set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (authError) {
        const msg = authError.message ?? "";
        if (/failed to fetch|network|fetch/i.test(msg)) {
          setError("Could not reach the authentication server. Check your connection and Supabase URL.");
        } else {
          setError(msg || "Sign in failed.");
        }
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error — could not reach the authentication server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex" style={{ background: "#060c18" }}>

      {/* ── Left panel ── */}
      <div
        className="hidden lg:flex flex-col w-[460px] flex-shrink-0 border-r p-10 justify-between"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "#070d1a" }}
      >
        <div>
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-14">
            <div
              className="w-7 h-7 rounded flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #00c9ff, #7c3aed)" }}
            >
              <Database className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold" style={{ fontFamily: "Outfit, sans-serif", color: "#dde4f4" }}>
              Total Scraper Web
            </span>
          </div>

          {/* Tagline */}
          <h2
            className="text-4xl font-bold mb-4"
            style={{ fontFamily: "Outfit, sans-serif", color: "#dde4f4", letterSpacing: "-0.025em", lineHeight: 1.15 }}
          >
            Social intelligence<br />at scale.
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: "#5a7294" }}>
            Extract, analyse, and act on social media data with precision tools built for brand researchers, analysts, and growth teams.
          </p>
        </div>

        {/* Feature list */}
        <div className="space-y-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.text} className="flex items-center gap-3 text-sm" style={{ color: "#5a7294" }}>
                <Icon className="w-4 h-4 flex-shrink-0" style={{ color: "#00c9ff" }} />
                {f.text}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right panel (form) ── */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <div
              className="w-7 h-7 rounded flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #00c9ff, #7c3aed)" }}
            >
              <Database className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold" style={{ fontFamily: "Outfit, sans-serif", color: "#dde4f4" }}>
              Total Scraper Web
            </span>
          </div>

          <div
            className="rounded-xl border p-7"
            style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}
          >
            <h1
              className="text-xl font-bold mb-1"
              style={{ fontFamily: "Outfit, sans-serif", color: "#dde4f4" }}
            >
              Welcome back
            </h1>
            <p className="text-sm text-muted-foreground mb-6">Sign in to your account</p>

            {justCreated && (
              <div
                className="rounded-lg px-3 py-2.5 text-sm mb-4"
                style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#10b981" }}
              >
                Account created — sign in with your new credentials.
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={resetting}
                    className="text-[11px] text-primary hover:opacity-80 transition-opacity disabled:opacity-50"
                  >
                    {resetting ? "Sending…" : "Forgot password?"}
                  </button>
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div
                  className="rounded-lg px-3 py-2 text-sm"
                  style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}
                >
                  {error}
                </div>
              )}

              {resetMsg && (
                <div
                  className="rounded-lg px-3 py-2 text-sm"
                  style={{ background: "rgba(0,201,255,0.06)", border: "1px solid rgba(0,201,255,0.2)", color: "#00c9ff" }}
                >
                  {resetMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-60 mt-2"
                style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
              >
                {loading ? "Signing in…" : "Sign In"}
              </button>
            </form>

            <p className="text-sm text-center text-muted-foreground mt-6">
              Need an account?{" "}
              <Link href="/signup" className="text-primary font-medium hover:opacity-80 transition-opacity">
                Sign up
              </Link>
            </p>
          </div>

          <p className="text-[11px] text-center text-muted-foreground mt-4">
            <Link href="/" className="hover:text-foreground transition-colors">← Back to home</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
