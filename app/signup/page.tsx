"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, inviteCode }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Signup failed. Please try again.");
      setLoading(false);
      return;
    }

    if (data.requiresConfirmation) {
      setAwaitingConfirmation(true);
    } else {
      router.push("/queue");
      router.refresh();
    }
  }

  if (awaitingConfirmation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border p-8 text-center">
          <div className="text-4xl mb-4">📧</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Check your email</h2>
          <p className="text-sm text-gray-500 mb-6">
            We sent a confirmation link to <strong>{email}</strong>. Click it to activate
            your account, then log in.
          </p>
          <Link
            href="/login"
            className="inline-block px-4 py-2 bg-[#1F4E78] text-white text-sm font-semibold rounded-lg hover:bg-[#2E86AB] transition-colors"
          >
            Go to Log In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#1F4E78]">Total Scraper</h1>
          <p className="text-sm text-gray-500 mt-1">Cimory Intel Platform</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Create account</h2>
          <p className="text-xs text-gray-500 mb-6">An invite code is required.</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1F4E78] focus:border-transparent"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1F4E78] focus:border-transparent"
                placeholder="Min. 6 characters"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Invite Code
              </label>
              <input
                type="password"
                required
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1F4E78] focus:border-transparent"
                placeholder="••••••••"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[#1F4E78] text-white text-sm font-semibold rounded-lg hover:bg-[#2E86AB] transition-colors disabled:opacity-60"
            >
              {loading ? "Creating account…" : "Sign Up"}
            </button>
          </form>
          <p className="text-sm text-center text-gray-500 mt-6">
            Already have an account?{" "}
            <Link href="/login" className="text-[#1F4E78] font-medium hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}