"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const inputCls =
  "w-full px-3 py-2.5 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error,           setError]           = useState("");
  const [success,         setSuccess]         = useState(false);
  const [loading,         setLoading]         = useState(false);

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) {
        setError(updErr.message || "Could not update password.");
        return;
      }
      setSuccess(true);
    } catch {
      setError("Network error — could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ background: "rgba(6,12,24,0.7)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6"
        style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(0,201,255,0.12)" }}
            >
              <KeyRound className="w-4 h-4" style={{ color: "#00c9ff" }} />
            </div>
            <h2 className="text-base font-bold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>
              Change password
            </h2>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {success ? (
          <div className="text-center py-4">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)" }}
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" style={{ color: "#10b981" }}>
                <path d="M5 12l5 5 9-10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-sm font-medium" style={{ color: "#10b981" }}>Password updated</p>
            <p className="text-xs text-muted-foreground mt-1.5">Your new password is now active.</p>
            <button
              onClick={onClose}
              className="mt-5 w-full py-2.5 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
                New password
              </label>
              <input
                autoFocus
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
                Confirm new password
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputCls}
                placeholder="Re-enter your password"
                style={mismatch ? { borderColor: "rgba(239,68,68,0.5)" } : undefined}
              />
              {mismatch && (
                <p className="text-[11px] mt-1.5" style={{ color: "#ef4444" }}>Passwords don&apos;t match.</p>
              )}
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
              disabled={loading || mismatch}
              className="w-full py-2.5 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
            >
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
