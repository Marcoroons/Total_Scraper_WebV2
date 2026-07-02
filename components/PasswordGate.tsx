"use client";

import { useState, useEffect } from "react";
import { Lock } from "lucide-react";

// Client-side password gate. Storage-keyed so multiple gates on the same
// origin don't share auth state. Once unlocked, the flag persists in
// localStorage until it's manually cleared (browser DevTools → Application →
// Local Storage → delete `competitor_admin`).
//
// This is a barrier, not a secure boundary — the password is bundled into
// the client JS. Adequate for an internal tool where the goal is "keep
// casual users out of an admin-only view", not a security-critical gate.
// Move to a server-side check (API route + httpOnly cookie) if you ever
// need to gate sensitive data at the network level.

interface Props {
  storageKey: string;
  password: string;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function PasswordGate({
  storageKey,
  password,
  title = "Admin access required",
  subtitle,
  children,
}: Props) {
  // `null` while hydrating so we don't flash the gate to already-authed
  // users. localStorage isn't available during SSR.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setAuthed(
      typeof window !== "undefined" && window.localStorage.getItem(storageKey) === "1"
    );
  }, [storageKey]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (input === password) {
      window.localStorage.setItem(storageKey, "1");
      setAuthed(true);
      setInput("");
      setError("");
    } else {
      setError("Incorrect password.");
    }
  }

  if (authed === null) return null;   // hydrating — render nothing to avoid flash
  if (authed) return <>{children}</>;

  return (
    <div className="max-w-md mx-auto mt-16">
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5" style={{ color: "#7c3aed" }} />
          <h1 className="text-lg font-bold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>
            {title}
          </h1>
        </div>
        {subtitle && (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )}
        <form onSubmit={submit} className="space-y-3">
          <input
            type="password"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(""); }}
            placeholder="Password"
            autoFocus
            className="w-full px-3 py-2 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {error && (
            <p className="text-xs" style={{ color: "#ef4444" }}>⚠️ {error}</p>
          )}
          <button
            type="submit"
            disabled={!input}
            className="w-full py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: "linear-gradient(135deg, #7c3aed, #5b21b6)", color: "white" }}
          >
            Unlock
          </button>
        </form>
      </div>
    </div>
  );
}
