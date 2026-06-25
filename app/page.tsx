"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Database,
  FileText,
  Hash,
  MessageSquare,
  TrendingUp,
  User,
  Video,
} from "lucide-react";

const FEATURES = [
  {
    icon: Video,
    title: "Video URL Scraper",
    desc: "Paste a batch of video URLs and extract engagement data, captions, and audio metadata at scale.",
    accent: "#f59e0b",
  },
  {
    icon: User,
    title: "Profile Scraper",
    desc: "Pull complete profile data including follower history, post frequency, and engagement averages.",
    accent: "#a78bfa",
  },
  {
    icon: MessageSquare,
    title: "Sentiment Analysis",
    desc: "NLP-powered comment analysis to classify tone, detect emotion, and surface intent patterns.",
    accent: "#f472b6",
  },
  {
    icon: Hash,
    title: "Hashtag & Trends",
    desc: "Track content volume, discover rising hashtags, and benchmark performance over time.",
    accent: "#2dd4bf",
  },
  {
    icon: TrendingUp,
    title: "Competitor Analysis",
    desc: "Side-by-side comparison of brand presence, posting cadence, and audience engagement across accounts.",
    accent: "#fb923c",
  },
  {
    icon: FileText,
    title: "Report Builder",
    desc: "Generate structured Excel reports instantly or send them to your team on a recurring schedule.",
    accent: "#00c9ff",
  },
];

export default function LandingPage() {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div className="min-h-screen overflow-y-auto" style={{ background: "#060c18" }}>

      {/* ── Nav ── */}
      <nav
        className="sticky top-0 z-50 flex items-center justify-between px-8 py-4"
        style={{
          background: "rgba(6,12,24,0.92)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #00c9ff, #7c3aed)" }}
          >
            <Database className="w-3.5 h-3.5 text-white" />
          </div>
          <span
            className="text-sm font-semibold tracking-tight"
            style={{ fontFamily: "Outfit, sans-serif", color: "#dde4f4" }}
          >
            Total Scraper
          </span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="#disclaimers"
            className="text-xs font-mono transition-colors hover:text-[#8899b0]"
            style={{ color: "#5a7294" }}
          >
            Disclaimers
          </a>
          <Link
            href="/login"
            className="px-5 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
          >
            Sign In
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <div className="relative px-8 pt-24 pb-20 text-center overflow-hidden">
        {/* Glow blob */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none"
          style={{
            width: 700,
            height: 420,
            background: "radial-gradient(ellipse, rgba(0,201,255,0.13) 0%, transparent 68%)",
            filter: "blur(60px)",
          }}
        />

        <div className="relative">
          {/* Badge */}
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono border mb-6"
            style={{
              background: "rgba(0,201,255,0.08)",
              borderColor: "rgba(0,201,255,0.2)",
              color: "#00c9ff",
            }}
          >
            Instagram &amp; TikTok social intelligence
          </span>

          {/* Headline */}
          <h1
            className="text-6xl font-extrabold leading-none mb-6"
            style={{ fontFamily: "Outfit, sans-serif", color: "#dde4f4", letterSpacing: "-0.03em" }}
          >
            Total Scraper<br />
            <span
              style={{
                background: "linear-gradient(90deg, #00c9ff 0%, #7c3aed 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Web
            </span>
          </h1>

          {/* Sub */}
          <p
            className="text-base max-w-lg mx-auto leading-relaxed mb-8"
            style={{ color: "#5a7294" }}
          >
            Precision data extraction, NLP sentiment analysis, and competitive benchmarking
            built for researchers and brand teams.
          </p>

          {/* CTAs */}
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/signup"
              className="flex items-center gap-2 px-7 py-3 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
              style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
            >
              Create account <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/login"
              className="px-7 py-3 rounded-lg text-sm font-semibold border transition-colors hover:border-[rgba(255,255,255,0.18)]"
              style={{
                background: "transparent",
                borderColor: "rgba(255,255,255,0.1)",
                color: "#8899b0",
              }}
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>

      {/* ── Features ── */}
      <div className="px-8 py-16 max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <h2
            className="text-3xl font-bold mb-3"
            style={{ fontFamily: "Outfit, sans-serif", color: "#dde4f4", letterSpacing: "-0.02em" }}
          >
            Six precision tools
          </h2>
          <p className="text-sm" style={{ color: "#5a7294" }}>
            Each built for a specific intelligence use case. Pick one and start collecting.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            const isHovered = hovered === i;
            return (
              <Link
                key={i}
                href="/signup"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                className="rounded-xl border p-6 block transition-all duration-200 relative overflow-hidden no-underline"
                style={{
                  background: isHovered ? `${f.accent}08` : "#0d1829",
                  borderColor: isHovered ? `${f.accent}45` : "rgba(255,255,255,0.07)",
                  transform: isHovered ? "translateY(-2px)" : "none",
                  boxShadow: isHovered ? `0 8px 24px ${f.accent}18` : "none",
                  textDecoration: "none",
                }}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center mb-4 transition-all duration-200"
                  style={{
                    background: isHovered ? `${f.accent}22` : `${f.accent}12`,
                    border: `1px solid ${f.accent}${isHovered ? "50" : "20"}`,
                    transform: isHovered ? "scale(1.1)" : "scale(1)",
                  }}
                >
                  <Icon className="w-4 h-4" style={{ color: f.accent }} />
                </div>
                <h3
                  className="text-sm font-semibold mb-2 transition-colors"
                  style={{ fontFamily: "Outfit, sans-serif", color: isHovered ? "#dde4f4" : "#c8d8ed" }}
                >
                  {f.title}
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: "#5a7294" }}>
                  {f.desc}
                </p>
                <div
                  className="flex items-center gap-1 mt-4 text-[11px] font-mono transition-all duration-200"
                  style={{ color: isHovered ? f.accent : "transparent" }}
                >
                  Try it <ArrowRight className="w-3 h-3" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Disclaimers ── */}
      <div id="disclaimers" className="px-8 pb-16 max-w-4xl mx-auto">
        <div
          className="rounded-xl border p-6"
          style={{ background: "#0d1829", borderColor: "rgba(245,158,11,0.2)" }}
        >
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: "#f59e0b" }} />
            <h3
              className="text-sm font-semibold"
              style={{ fontFamily: "Outfit, sans-serif", color: "#dde4f4" }}
            >
              Legal disclaimers &amp; terms of use
            </h3>
          </div>
          <div className="space-y-3 text-xs leading-relaxed" style={{ color: "#5a7294" }}>
            <p>
              <strong style={{ color: "#8899b0" }}>Platform terms of service:</strong>{" "}
              Total Scraper Web is provided as a research and analytics tool. Users are solely responsible for ensuring their use of scraped data complies with the terms of service of Instagram, TikTok, and any applicable platform. Automated data collection may violate platform ToS and users accept all associated risk.
            </p>
            <p>
              <strong style={{ color: "#8899b0" }}>GDPR and privacy compliance:</strong>{" "}
              Scraped data may contain personally identifiable information. Users must comply with GDPR, CCPA, and applicable privacy regulations when storing, processing, or sharing collected data. Total Scraper Web does not assume responsibility for user data handling.
            </p>
            <p>
              <strong style={{ color: "#8899b0" }}>Research use only:</strong>{" "}
              This platform is intended for legitimate market research, brand analytics, and academic purposes. Commercial redistribution of scraped data without appropriate licensing is strictly prohibited.
            </p>
            <p>
              <strong style={{ color: "#8899b0" }}>No warranty:</strong>{" "}
              Data accuracy and completeness are not guaranteed. Platform API changes or rate limiting may affect data availability at any time. Total Scraper Web accepts no liability for decisions made based on collected data.
            </p>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div
        className="px-8 py-5 flex items-center justify-between"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        <span className="text-[11px] font-mono" style={{ color: "#283d58" }}>
          © 2026 Total Scraper Web
        </span>
        <div className="flex gap-5 text-[11px] font-mono" style={{ color: "#283d58" }}>
          <a href="#disclaimers" className="hover:text-[#5a7294] transition-colors">Privacy Policy</a>
          <a href="#disclaimers" className="hover:text-[#5a7294] transition-colors">Terms</a>
          <a href="mailto:support@totalscraper.com" className="hover:text-[#5a7294] transition-colors">Contact</a>
        </div>
      </div>

    </div>
  );
}
