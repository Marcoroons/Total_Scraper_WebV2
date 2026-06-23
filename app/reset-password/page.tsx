"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Database } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const inputCls =
  "w-full px-3 py-2.5 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready,    setReady]    = useState(false);   // recovery session present
  const [checking, setChecking] = useState(true);
  const [pw,       setPw]       = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [msg,      setMsg]      = useState<{ ok: boolean; text: string } | null>(null);

  const mismatch = confirm.length > 0 && pw !== confirm;

  useEffect(() => {
    const sb = createClient();
    // The email link carries recovery tokens in the URL hash; supabase-js
    // processes them on load and fires PASSWORD_RECOVERY / sets a session.
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) { setReady(true); setChecking(false); }
    });
    sb.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
      setChecking(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (pw.length < 6)   { setMsg({ ok: false, text: "Password must be at least 6 characters." }); return; }
    if (pw !== confirm)  { setMsg({ ok: false, text: "Passwords do not match." }); return; }
    setLoading(true);
    try {
      const sb = createClient();
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) { setMsg({ ok: false, text: error.message || "Could not update password." }); return; }
      setMsg({ ok: true, text: "Password updated — redirecting to sign in…" });
      setTimeout(() => router.push("/login?reset=1"), 1500);
    } catch {
      setMsg({ ok: false, text: "Network error — could not update password." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "#060c18" }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="w-7 h-7 rounded flex items-center justify-center" style={{ background: "linear-gradient(135deg, #00c9ff, #7c3aed)" }}>
            <Database className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold" style={{ fontFamily: "Outfit, sans-serif", color: "#dde4f4" }}>Total Scraper Web</span>
        </div>

        <div className="rounded-xl border p-7" style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}>
          <h1 className="text-xl font-bold mb-1" style={{ fontFamily: "Outfit, sans-serif", color: "#dde4f4" }}>Set a new password</h1>

          {checking ? (
            <p className="text-sm text-muted-foreground mt-2">Verifying your reset link…</p>
          ) : !ready ? (
            <>
              <p className="text-sm text-muted-foreground mt-2 mb-5">
                This reset link is invalid or has expired. Request a new one from the sign-in page.
              </p>
              <Link href="/login" className="inline-block px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}>
                Back to sign in
              </Link>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <input type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (min. 6 chars)" className={inputCls} />
              <input
                type="password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm new password" className={inputCls}
                style={mismatch ? { borderColor: "rgba(239,68,68,0.5)" } : undefined}
              />
              {mismatch && <p className="text-[11px]" style={{ color: "#ef4444" }}>Passwords don&apos;t match.</p>}
              {msg && (
                <div className="rounded-lg px-3 py-2 text-sm" style={msg.ok
                  ? { background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#10b981" }
                  : { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
                  {msg.text}
                </div>
              )}
              <button type="submit" disabled={loading || mismatch}
                className="w-full py-2.5 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}>
                {loading ? "Updating…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
