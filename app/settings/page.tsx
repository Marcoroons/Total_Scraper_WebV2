"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, KeyRound, Shield, Trash2 } from "lucide-react";
import { CatSpinner } from "@/components/CatSpinner";
import { createClient } from "@/lib/supabase/client";

const inputCls =
  "w-full px-3 py-2.5 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

// ─── PDPA / regulatory content ─────────────────────────────────────────────────

const REGULATORY = [
  {
    title: "Data we process",
    body: "Total Scraper collects publicly available social media data (posts, video metrics, captions, public comments, and public profile information) from Instagram and TikTok via third-party APIs (Apify). Scraped data is stored in our Supabase database and is accessible only to authenticated members of the project it was collected under.",
  },
  {
    title: "PDPA (Singapore) compliance",
    body: "Under Singapore's Personal Data Protection Act 2012, scraped public comments and profiles may constitute personal data. As the organisation collecting and using this data, you are responsible for ensuring a lawful basis and reasonable purpose for its collection, restricting use to the research/analytics purpose it was gathered for, protecting it with reasonable security, and honouring access/correction requests from individuals. Do not use collected data for unrelated purposes (e.g. unsolicited marketing) without appropriate consent.",
  },
  {
    title: "GDPR / CCPA",
    body: "If you process data of individuals in the EU/UK (GDPR) or California (CCPA), you must comply with those regimes too — including lawful basis, data-minimisation, and the rights to access, rectification, and erasure. Total Scraper provides the tooling; compliance for how you store, share, and act on the data rests with you.",
  },
  {
    title: "Your rights & data control",
    body: "You can change your password at any time above, and permanently delete your account and associated profile/membership records in the Danger Zone below. To remove specific scraped datasets, delete the relevant jobs/projects. For data-subject requests concerning individuals in your scraped data, you (as the data controller) are responsible for fulfilling them.",
  },
  {
    title: "Platform terms of service",
    body: "Automated collection may conflict with the terms of service of Instagram, TikTok, and other platforms. You are solely responsible for ensuring your use complies with each platform's ToS and accept all associated risk. Total Scraper is a research and analytics tool, not a means to circumvent platform policies.",
  },
  {
    title: "Retention & security",
    body: "Data persists in the database until you delete it. Access is gated by authentication and per-project membership. Secrets (API keys, service credentials) are stored as server-side environment variables and are never exposed to the browser. Rotate any credential you believe has been exposed.",
  },
  {
    title: "Data completeness & accuracy",
    body: "Scrapes can return fewer posts than requested, or none at all. Common causes: private/restricted accounts the API cannot read, platform rate-limiting, a date range that excludes most of a creator's recent posts, and content-type filters (e.g. 'Reels Only' on an image-heavy account). The live failure rate is shown on the Dashboard. A zero- or low-post result means the data was inconclusive — it should NOT be read as zero performance for that creator.",
  },
  {
    title: "Research use & no warranty",
    body: "This platform is intended for legitimate market research, brand analytics, and academic purposes. Commercial redistribution of scraped data without appropriate licensing is prohibited. Data accuracy and availability are not guaranteed — platform/API changes or rate limiting may affect results at any time, and no liability is accepted for decisions made on collected data.",
  },
];

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string>("");

  // Change password
  const [pw, setPw]               = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg]         = useState<{ ok: boolean; text: string } | null>(null);
  const pwMismatch = pwConfirm.length > 0 && pw !== pwConfirm;

  // Delete account
  const [confirmText, setConfirmText] = useState("");
  const [delLoading, setDelLoading]   = useState(false);
  const [delErr, setDelErr]           = useState("");

  useEffect(() => {
    (async () => {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (user?.email) setEmail(user.email);
    })();
  }, []);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (pw.length < 6) { setPwMsg({ ok: false, text: "Password must be at least 6 characters." }); return; }
    if (pw !== pwConfirm) { setPwMsg({ ok: false, text: "Passwords do not match." }); return; }
    setPwLoading(true);
    try {
      const sb = createClient();
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) { setPwMsg({ ok: false, text: error.message || "Could not update password." }); return; }
      setPwMsg({ ok: true, text: "Password updated." });
      setPw(""); setPwConfirm("");
    } catch {
      setPwMsg({ ok: false, text: "Network error — could not update password." });
    } finally {
      setPwLoading(false);
    }
  }

  async function handleDelete() {
    setDelErr("");
    setDelLoading(true);
    try {
      const res = await fetch("/api/auth/delete-account", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setDelErr((data as { error?: string }).error ?? "Could not delete account."); return; }
      // Account gone — sign out client + leave.
      const sb = createClient();
      await sb.auth.signOut().catch(() => {});
      router.push("/login?deleted=1");
    } catch {
      setDelErr("Network error — could not delete account.");
    } finally {
      setDelLoading(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Account, privacy &amp; data controls.</p>
      </div>

      {/* ── Account ── */}
      <section className="bg-card border border-border rounded-2xl p-5">
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Account</p>
        <div className="text-sm mb-5">
          <span className="text-muted-foreground">Signed in as </span>
          <span className="text-foreground font-medium">{email || "…"}</span>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <KeyRound className="w-4 h-4" style={{ color: "#00c9ff" }} />
          <p className="text-sm font-medium text-foreground">Change password</p>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-3 max-w-sm">
          <input type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (min. 6 chars)" className={inputCls} />
          <input
            type="password" required minLength={6} value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)}
            placeholder="Confirm new password" className={inputCls}
            style={pwMismatch ? { borderColor: "rgba(239,68,68,0.5)" } : undefined}
          />
          {pwMismatch && <p className="text-[11px]" style={{ color: "#ef4444" }}>Passwords don&apos;t match.</p>}
          {pwMsg && (
            <p className="text-xs" style={{ color: pwMsg.ok ? "#10b981" : "#ef4444" }}>
              {pwMsg.ok ? "✅ " : "⚠️ "}{pwMsg.text}
            </p>
          )}
          <button
            type="submit" disabled={pwLoading || pwMismatch}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
          >
            {pwLoading ? <CatSpinner size={16} /> : <KeyRound className="w-4 h-4" />}
            {pwLoading ? "Updating…" : "Update password"}
          </button>
        </form>
      </section>

      {/* ── Privacy & Regulatory ── */}
      <section className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-4 h-4" style={{ color: "#00c9ff" }} />
          <p className="text-sm font-semibold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>Data, privacy &amp; regulatory</p>
        </div>
        <p className="text-xs text-muted-foreground mb-4">PDPA, GDPR/CCPA, platform terms, retention, and your responsibilities as data controller.</p>
        <div className="space-y-4">
          {REGULATORY.map((r) => (
            <div key={r.title}>
              <p className="text-sm font-medium text-foreground mb-1">{r.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Danger zone ── */}
      <section className="rounded-2xl p-5" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.25)" }}>
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-4 h-4" style={{ color: "#ef4444" }} />
          <p className="text-sm font-semibold" style={{ fontFamily: "Outfit, sans-serif", color: "#f87171" }}>Danger zone</p>
        </div>
        <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
          Permanently delete your account and your profile &amp; team/project membership records. This cannot be undone.
          Type <strong className="text-foreground">DELETE</strong> to confirm.
        </p>
        <div className="flex flex-wrap items-center gap-3 max-w-md">
          <input
            type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE"
            className="flex-1 min-w-[160px] px-3 py-2 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2"
            style={{ ["--tw-ring-color" as string]: "rgba(239,68,68,0.4)" }}
          />
          <button
            type="button"
            onClick={handleDelete}
            disabled={confirmText !== "DELETE" || delLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors disabled:opacity-40"
            style={{ background: confirmText === "DELETE" ? "#ef4444" : "rgba(239,68,68,0.2)", color: confirmText === "DELETE" ? "#fff" : "#f87171" }}
          >
            {delLoading ? <CatSpinner size={16} /> : <Trash2 className="w-4 h-4" />}
            {delLoading ? "Deleting…" : "Delete my account"}
          </button>
        </div>
        {delErr && <p className="text-xs mt-3" style={{ color: "#ef4444" }}>⚠️ {delErr}</p>}
      </section>
    </div>
  );
}
