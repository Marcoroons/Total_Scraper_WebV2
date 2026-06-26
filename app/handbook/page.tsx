"use client";

import {
  ArrowRight, BookOpen, MessageSquare, Search, SlidersHorizontal, Sparkles, TrendingUp, User, Video,
} from "lucide-react";

// ─── Data pipeline (Pre / Post project) ───────────────────────────────────────

const PIPELINE = [
  {
    phase: "Pre-Project — choosing & vetting KOLs",
    blurb: "Before you spend a cent on a creator, use these to decide who's worth it.",
    items: [
      { name: "KOL Finder", soon: false, desc: "Ranks the creators surfacing under your scraped hashtags by reach, engagement and frequency, and flags who you've already scraped across projects/teams." },
      { name: "URL + Profile Scraper", soon: false, desc: "Pull KOL metrics by individual video (URL) or whole profile to back-test a chosen creator's real worth before committing budget." },
      { name: "Comment Sentiment Analysis", soon: false, desc: "Read how a KOL's audience actually feels — do their viewers and influence fit our needs and benefit us?" },
      { name: "Hashtag / Trends", soon: false, desc: "Scrapes top content under hashtags, then surfaces trending creators and the winning video formats for your space." },
    ],
  },
  {
    phase: "Post-Project — measuring what you posted",
    blurb: "After the campaign goes live, track performance and audience reaction.",
    items: [
      { name: "URL Scraper", soon: false, desc: "Check the progress of your posted videos, and use the scheduled scraper for automatic recurring updates." },
      { name: "Comment Sentiment Analysis", soon: false, desc: "Analyse individual posted videos — what do people actually think of our product?" },
    ],
  },
];

// ─── Function usage & descriptions ─────────────────────────────────────────────

const FUNCTIONS = [
  {
    name: "Video URL Scraper", icon: Video, color: "#f59e0b", soon: false,
    how: "Pick a platform, paste a batch of video URLs (one per line), and queue — every metric is captured automatically.",
    requires: "Video URLs.",
    produces: "Per-video engagement (views, likes, comments, shares). Choose which columns and calculated metrics to show in the Exporter.",
  },
  {
    name: "Profile Scraper", icon: User, color: "#a78bfa", soon: false,
    how: "Pick platform & content type, set posts-per-profile and an optional date range, paste profiles, queue. Metrics and video sort order are chosen later in the Exporter.",
    requires: "Content type and ≥1 profile. Date range is optional.",
    produces: "A per-creator audit (avg/most/least views, KPI estimate, per-video breakdown) compiled into one Excel from the Exporter.",
  },
  {
    name: "Comment Sentiment Analysis", icon: MessageSquare, color: "#f472b6", soon: false,
    how: "On the Comment Scraper tab, paste video URLs + their KOL handle and set max comments. Configure the dictionaries on the NLP Settings tab (same page) before exporting.",
    requires: "Video URL + KOL username per row. Requires the NLP table (NLP Settings tab) to be configured for accurate scoring.",
    produces: "Raw comments stored on scrape; sentiment, themes, purchase intent and PR-crisis flags applied at export time.",
  },
  {
    name: "Queue & Exporter", icon: ArrowRight, color: "#00c9ff", soon: false,
    how: "Job Queue shows live status (Pending / Processing / Completed / Failed) with counts. The Exporter lets you filter finished jobs, select rows (click-drag to multi-select), rescrape failures, and export/schedule.",
    requires: "Completed jobs to export.",
    produces: "One compiled Excel per scrape type, downloaded directly or scheduled to email.",
  },
  {
    name: "KOL Finder", icon: Search, color: "#10b981", soon: false,
    how: "Scrape hashtags, then rank the creators who appear by reach, engagement rate and frequency. Filter by hashtag and flag creators already in your database.",
    requires: "Hashtag scrapes in the project.", produces: "A ranked KOL shortlist, exportable to CSV.",
  },
  {
    name: "Hashtag / Trends", icon: TrendingUp, color: "#2dd4bf", soon: false,
    how: "Scrape top content under hashtags, then view trending creators and reverse-engineer the winning video format.",
    requires: "Hashtags to scrape.", produces: "Trend & format insights, exportable to CSV.",
  },
];

// ─── What's new & how to use it ────────────────────────────────────────────────

const WHATS_NEW = [
  {
    name: "Excel builder (Advanced export settings)",
    desc: "In the Exporter, open “Advanced export settings · Excel builder” to DIY the profile-audit workbook. Pick a preset — Detailed (everything), Compact (a tight one-row-per-creator overview), or Per-video (leads with the per-video table) — or go Custom: toggle which sheets appear (KOL Views, Video Details, Export Notes), choose the optional columns on each, and the file is reordered to match.",
  },
  {
    name: "Play Count vs View Count + VTR",
    desc: "The Excel builder’s Video Details sheet now has separate Play Count and View Count columns (toggle either off in the builder), and VTR (View-Through Rate = View Count ÷ Play Count) is selectable as a calculated metric again. Under “View metric”, switch the summary averages between Play Count (total plays, incl. loops) and View Count (reach). Instagram increasingly reports a single figure, so the two can show the same numbers and VTR reads ~100% until distinct data is available; TikTok only has plays.",
  },
  {
    name: "Engagement Rate for photos (follower-based)",
    desc: "On the Profile Tracker, tick “Fetch follower count” when scraping All Formats or Images/Carousel posts — one extra Apify lookup per creator stores the follower count. The Exporter then computes image-post Engagement Rate as (likes + comments + shares) ÷ followers, so reels and photos both produce a real ER. Reels keep views-based ER; image posts without a follower count stay N/A.",
  },
  {
    name: "Content-type filter — videos vs images",
    desc: "“Content type” limits an export to Videos only, Images only, or All, so reels and photos aren’t aggregated together. Reels carry a view count; photos and carousels don’t — so image posts list their likes/comments but show view-based metrics (Engagement Rate, etc.) as N/A, and the KOL Views sheet averages videos only with a “# Images” tally alongside.",
  },
  {
    name: "Animated task loader",
    desc: "The loading cat now appears inline wherever something is working — exporting, scheduling, rescraping, or loading a list — in place of the old spinner.",
  },
  {
    name: "Saved-password sign-in",
    desc: "The login and sign-up forms are now recognised by browser / Google password managers, so saved credentials autofill. If your browser stored the old form, sign in once and re-save to refresh it.",
  },
];

// ─── Metric explanations ───────────────────────────────────────────────────────

const METRICS = [
  { name: "Play Count", what: "Total times a video started playing, including replays and loops — the broadest reach figure for reels. NOT the same as follower count (a creator with millions of followers commonly averages far fewer plays per post). Photos/carousels have no play count." },
  { name: "View Count", what: "The reach-style view figure Instagram reports for a video. Instagram has largely merged 'plays' and 'views' into one number, so View Count often equals Play Count — they diverge only when the platform returns both separately. TikTok exposes only plays." },
  { name: "VTR (View-Through Rate)", what: "View Count ÷ Play Count × 100% — the share of plays that registered as views. Reads ~100% when Instagram reports a single figure; only meaningful when plays and views differ. Instagram-only, and reels-only (photos have neither)." },
  { name: "Likes", what: "How many viewers tapped like. A light signal of approval." },
  { name: "Comments", what: "How many viewers wrote a comment. Heavier engagement than a like — people took time to respond." },
  { name: "Shares", what: "How many viewers re-shared the post. The strongest organic signal — content people pass on travels furthest." },
  { name: "Engagement Rate", what: "How much people actually interact with a video relative to its reach — (likes + comments + shares) ÷ views. The single best 'is this audience active?' number; high views with low engagement = passive audience." },
  { name: "Avg Views", what: "The creator's average views across the scraped videos — a stable expectation of typical reach, less misleading than a single viral hit." },
  { name: "Most / Least Views", what: "Their best and worst performing scraped videos — shows the spread between a viral outlier and a normal post." },
  { name: "KPI Est. Views (next video)", what: "A conservative forecast of what a future post might get: the median of their historical views (median, so one viral video doesn't inflate it), rounded for budget planning." },
  { name: "Top 5 / Bottom 5 Avg Views", what: "Average views of their 5 best / 5 worst videos — useful to judge consistency vs. one-hit-wonder creators." },
  { name: "Follower Count", what: "Audience size. Context only — it sets scale but does not predict views or engagement on its own." },
  { name: "Post Frequency", what: "How often the creator posts. Indicates how active and 'fresh' the account is." },
  { name: "Sentiment (Positive / Neutral / Negative)", what: "NLP classification of each comment's tone — the core read on whether an audience likes the content or product." },
  { name: "Purchase Intent", what: "Flags comments signalling buying interest (e.g. 'where to buy', 'price?') — direct demand signal." },
  { name: "Themes", what: "Groups comments by topic (packaging, price, taste, etc.) so you see what the conversation is actually about." },
  { name: "PR-Crisis Flag", what: "Raises an alert when comments match a defined risk pattern — early warning for reputation issues." },
];

// ─── Page ──────────────────────────────────────────────────────────────────────

function SoonBadge() {
  return (
    <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ml-2"
      style={{ background: "rgba(255,255,255,0.05)", color: "#5a7294", border: "1px solid rgba(255,255,255,0.08)" }}>
      soon
    </span>
  );
}

export default function HandbookPage() {
  return (
    <div className="max-w-4xl space-y-8 pb-10">

      {/* Header + take-the-tour */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2" style={{ fontFamily: "Outfit, sans-serif" }}>
            <BookOpen className="w-5 h-5" style={{ color: "#00c9ff" }} />
            Handbook
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            How to navigate Total Scraper, when to use each tool, and what every metric means.
          </p>
        </div>
        <button
          onClick={() => window.dispatchEvent(new Event("ts:start-tour"))}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
        >
          <Sparkles className="w-4 h-4" />
          Take the navigation tour
        </button>
      </div>

      {/* Purpose */}
      <section className="rounded-2xl border p-5" style={{ background: "#0d1829", borderColor: "rgba(0,201,255,0.18)" }}>
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">Why this exists</p>
        <p className="text-sm text-foreground leading-relaxed">
          Total Scraper turns Instagram &amp; TikTok data into decisions across a campaign&apos;s whole life cycle:
          <strong> before a project</strong> it helps you pick and vet the right KOLs (are they worth the budget, does their audience fit us?),
          and <strong>after a project</strong> it measures how your posted content performed and what people think of the product.
          Everything funnels through the <strong>Queue &amp; Exporter</strong>, where scraped data becomes Excel reports.
        </p>
      </section>

      {/* Data pipeline */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>Data pipeline — intended usage</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PIPELINE.map((phase) => (
            <div key={phase.phase} className="rounded-2xl border p-5" style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}>
              <p className="text-sm font-semibold text-foreground mb-1" style={{ fontFamily: "Outfit, sans-serif" }}>{phase.phase}</p>
              <p className="text-xs text-muted-foreground mb-4">{phase.blurb}</p>
              <ul className="space-y-3">
                {phase.items.map((it) => (
                  <li key={it.name} className="text-sm">
                    <span className="font-medium text-foreground">{it.name}</span>
                    {it.soon && <SoonBadge />}
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{it.desc}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Function usage */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>Function usage &amp; descriptions</h2>
        <div className="space-y-3">
          {FUNCTIONS.map((fn) => {
            const Icon = fn.icon;
            return (
              <div key={fn.name} className="rounded-2xl border p-5" style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${fn.color}14`, border: `1px solid ${fn.color}26` }}>
                    <Icon className="w-4 h-4" style={{ color: fn.color }} />
                  </div>
                  <span className="text-sm font-semibold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>{fn.name}</span>
                  {fn.soon && <SoonBadge />}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div><p className="font-mono uppercase tracking-wider text-muted-foreground mb-1 text-[10px]">How to use</p><p className="text-foreground leading-relaxed">{fn.how}</p></div>
                  <div><p className="font-mono uppercase tracking-wider text-muted-foreground mb-1 text-[10px]">Requires</p><p className="text-foreground leading-relaxed">{fn.requires}</p></div>
                  <div><p className="font-mono uppercase tracking-wider text-muted-foreground mb-1 text-[10px]">Produces</p><p className="text-foreground leading-relaxed">{fn.produces}</p></div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* What's new */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2" style={{ fontFamily: "Outfit, sans-serif" }}>
          <SlidersHorizontal className="w-4 h-4" style={{ color: "#00c9ff" }} />
          What&apos;s new &amp; how to use it
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {WHATS_NEW.map((it) => (
            <div key={it.name} className="rounded-2xl border p-5" style={{ background: "#0d1829", borderColor: "rgba(0,201,255,0.18)" }}>
              <p className="text-sm font-semibold text-foreground mb-1" style={{ fontFamily: "Outfit, sans-serif" }}>{it.name}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{it.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Metrics */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>Metric explanations</h2>
        <div className="rounded-2xl border overflow-hidden" style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#0f1e35" }}>
                <th className="px-5 py-2.5 text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground w-56">Metric</th>
                <th className="px-5 py-2.5 text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground">What it actually tells you</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m.name} className="border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                  <td className="px-5 py-3 align-top font-medium text-foreground">{m.name}</td>
                  <td className="px-5 py-3 text-muted-foreground leading-relaxed">{m.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
