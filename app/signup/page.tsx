"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Database, Shield, Zap, Globe } from "lucide-react";

const FEATURES = [
  { icon: Shield, text: "GDPR-aware data pipeline" },
  { icon: Zap,    text: "Real-time scraping queue" },
  { icon: Globe,  text: "Instagram & TikTok coverage" },
];

const inputCls =
  "w-full px-3 py-2.5 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export default function SignupPage() {
  const router = useRouter();
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [inviteCode,  setInviteCode]  = useState("");
  const [error,       setError]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, inviteCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Signup failed. Please try again.");
        return;
      }

      if (data.signInFailed) {
        // Account created but auto sign-in failed — send to login
        router.push("/login?created=1");
        return;
      }

      if (data.requiresConfirmation) {
        setAwaitingConfirmation(true);
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (awaitingConfirmation) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "#060c18" }}>
        <div
          className="w-full max-w-sm rounded-xl border p-8 text-center"
          style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}
        >
          <div className="text-4xl mb-4">📧</div>
          <h2
            className="text-lg font-bold mb-2"
            style={{ fontFamily: "Outfit, sans-serif", color: "#dde4f4" }}
          >
            Check your email
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            We sent a confirmation link to <strong className="text-foreground">{email}</strong>.
            Click it to activate your account, then log in.
          </p>
          <Link
            href="/login"
            className="inline-block px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
          >
            Go to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: "#060c18" }}>

      {/* ── Left panel ── */}
      <div
        className="hidden lg:flex flex-col w-[460px] flex-shrink-0 border-r p-10 justify-between"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "#070d1a" }}
      >
        <div>
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
              Create account
            </h1>
            <p className="text-sm text-muted-foreground mb-6">An invite code is required.</p>

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
                <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                  placeholder="Min. 6 characters"
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
                  Invite Code
                </label>
                <input
                  type="password"
                  required
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
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

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-60 mt-2"
                style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
              >
                {loading ? "Creating account…" : "Sign Up"}
              </button>
            </form>

            <p className="text-sm text-center text-muted-foreground mt-6">
              Already have an account?{" "}
              <Link href="/login" className="text-primary font-medium hover:opacity-80 transition-opacity">
                Sign in
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
