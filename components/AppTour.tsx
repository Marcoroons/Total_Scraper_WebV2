"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ─── Tour steps ───────────────────────────────────────────────────────────────

interface Step {
  target: string;
  title: string;
  body: string;
  placement: "right" | "left" | "bottom" | "top";
}

const STEPS: Step[] = [
  {
    target:    "logo",
    title:     "Welcome to Total Scraper Web",
    body:      "Your command centre for Instagram & TikTok data intelligence. Here's a 60-second tour of what each tool does — click the logo anytime to return home.",
    placement: "right",
  },
  {
    target:    "video-url-scraper",
    title:     "URL Tracking — Video URL Scraper",
    body:      "Paste a batch of Instagram or TikTok video URLs and pull hard engagement metrics for each one — views, likes, comments, shares — plus captions and audio data. Use this when you already know the exact posts you want to measure.",
    placement: "right",
  },
  {
    target:    "profile-scraper",
    title:     "Profile Tracking — Profile Scraper",
    body:      "Audit any creator or brand account: follower count, posting frequency, average engagement, and their recent feed. Great for benchmarking competitors or building an influencer shortlist before a campaign.",
    placement: "right",
  },
  {
    target:    "comment-sentiment",
    title:     "Comment Sentiment Analysis",
    body:      "Scrape the comments under any post and run NLP sentiment analysis — it classifies tone, flags emotion, and surfaces what your audience actually feels about a piece of content. You can fine-tune the model under NLP Settings.",
    placement: "right",
  },
  {
    target:    "teams",
    title:     "Teams & Projects",
    body:      "Organise everything into Projects and share them with your Team. Each scrape is scoped to the active project, so invited teammates can pick up exactly where you left off — manage members and roles from the Teams tab.",
    placement: "right",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAD       = 12;
const TOOLTIP_W = 304;

function getTargetRect(target: string): DOMRect | null {
  const el = document.querySelector(`[data-tour="${CSS.escape(target)}"]`);
  return el ? el.getBoundingClientRect() : null;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(v, max));
}

function tooltipCoords(rect: DOMRect, placement: Step["placement"]) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = 0, left = 0;

  switch (placement) {
    case "right":
      top  = rect.top + rect.height / 2 - 100;
      left = rect.right + PAD + 8;
      break;
    case "left":
      top  = rect.top + rect.height / 2 - 100;
      left = rect.left - TOOLTIP_W - PAD - 8;
      break;
    case "bottom":
      top  = rect.bottom + PAD + 8;
      left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
      break;
    case "top":
      top  = rect.top - 200 - PAD - 8;
      left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
      break;
  }

  return {
    top:  clamp(top,  PAD, vh - 220),
    left: clamp(left, PAD, vw - TOOLTIP_W - PAD),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AppTour() {
  const [mounted,  setMounted]  = useState(false);
  const [active,   setActive]   = useState(false);
  const [step,     setStep]     = useState(0);
  const [rect,     setRect]     = useState<DOMRect | null>(null);
  const userId = useRef<string | null>(null);

  // Hydration guard — portals need the DOM
  useEffect(() => { setMounted(true); }, []);

  const completeTour = useCallback(async () => {
    setActive(false);
    const id = userId.current;
    if (!id) return;
    // Local guard first — guarantees the tour never repeats on this browser
    // even if the Supabase write below fails (e.g. column not migrated yet).
    try { localStorage.setItem(`ts:tour-seen:${id}`, "1"); } catch { /* ignore */ }
    try {
      const sb = createClient();
      await sb.from("profiles").update({ has_completed_tour: true }).eq("id", id);
    } catch { /* best-effort */ }
  }, []);

  // Check tour status after mount — auto-start ONLY on a brand-new user's first
  // ever session (profile row exists with the flag still false, and the tour
  // hasn't already been seen on this browser).
  useEffect(() => {
    if (!mounted) return;
    (async () => {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      userId.current = user.id;

      try {
        if (localStorage.getItem(`ts:tour-seen:${user.id}`)) return;
      } catch { /* ignore */ }

      const { data: profile } = await sb
        .from("profiles")
        .select("has_completed_tour")
        .eq("id", user.id)
        .maybeSingle();

      if (profile && profile.has_completed_tour === false) {
        setStep(0);
        setActive(true);
      }
    })();
  }, [mounted]);

  // Listen for manual re-trigger (Tour button in header)
  useEffect(() => {
    function onRetrigger() {
      setStep(0);
      setActive(true);
    }
    window.addEventListener("ts:start-tour", onRetrigger);
    return () => window.removeEventListener("ts:start-tour", onRetrigger);
  }, []);

  // Re-measure target rect whenever step or active changes
  useEffect(() => {
    if (!active) return;
    const measure = () => setRect(getTargetRect(STEPS[step].target));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active, step]);

  const navigate = useCallback((dir: 1 | -1) => {
    const next = step + dir;
    if (next >= STEPS.length) {
      completeTour();
    } else {
      setStep(next);
    }
  }, [step, completeTour]);

  if (!mounted || !active || !rect) return null;

  const current = STEPS[step];
  const tp      = tooltipCoords(rect, current.placement);
  const vh      = typeof window !== "undefined" ? window.innerHeight : 800;

  // 4 panels that form the spotlight "cutout"
  const panels = [
    // top
    { top: 0, left: 0, width: "100vw", height: Math.max(0, rect.top - PAD) },
    // bottom
    { top: rect.bottom + PAD, left: 0, width: "100vw", height: Math.max(0, vh - rect.bottom - PAD) },
    // left
    { top: rect.top - PAD, left: 0, width: Math.max(0, rect.left - PAD), height: rect.height + PAD * 2 },
    // right
    { top: rect.top - PAD, left: rect.right + PAD, width: `calc(100vw - ${rect.right + PAD}px)`, height: rect.height + PAD * 2 },
  ];

  const OVERLAY = "rgba(6,12,24,0.82)";

  return createPortal(
    <>
      {/* 4-panel backdrop with spotlight cutout */}
      {panels.map((p, i) => (
        <div key={i} style={{ position: "fixed", ...p, background: OVERLAY, zIndex: 9998, pointerEvents: "all" }} />
      ))}

      {/* Cyan ring around the target */}
      <div style={{
        position:     "fixed",
        top:          rect.top  - PAD,
        left:         rect.left - PAD,
        width:        rect.width  + PAD * 2,
        height:       rect.height + PAD * 2,
        borderRadius: 10,
        border:       "1.5px solid rgba(0,201,255,0.5)",
        boxShadow:    "0 0 0 1px rgba(0,201,255,0.1), 0 0 24px rgba(0,201,255,0.12)",
        zIndex:       9999,
        pointerEvents:"none",
      }} />

      {/* Tooltip card */}
      <div style={{
        position:     "fixed",
        top:          tp.top,
        left:         tp.left,
        width:        TOOLTIP_W,
        background:   "#0d1829",
        border:       "1px solid rgba(0,201,255,0.22)",
        borderRadius: 14,
        boxShadow:    "0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,201,255,0.07)",
        zIndex:       10000,
        padding:      "18px 20px 20px",
      }}>
        {/* Step dots + dismiss X */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 14 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width:      i === step ? 18 : 6,
              height:     6,
              borderRadius: 3,
              background: i === step ? "#00c9ff" : "rgba(0,201,255,0.18)",
              transition: "all 0.25s ease",
            }} />
          ))}
          <button
            onClick={completeTour}
            style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#5a7294", padding: 2, display: "flex" }}
            title="Skip tour"
          >
            <X size={14} />
          </button>
        </div>

        {/* Step counter */}
        <p style={{ fontSize: 10, fontFamily: "monospace", color: "#3a4d68", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
          Step {step + 1} of {STEPS.length}
        </p>

        {/* Title */}
        <p style={{ fontSize: 13, fontWeight: 700, color: "#dde4f4", marginBottom: 8, fontFamily: "Outfit, sans-serif", lineHeight: 1.3 }}>
          {current.title}
        </p>

        {/* Body */}
        <p style={{ fontSize: 12, color: "#8899b0", lineHeight: 1.65, marginBottom: 20 }}>
          {current.body}
        </p>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {step > 0 && (
            <button
              onClick={() => navigate(-1)}
              style={{
                padding:      "7px 16px",
                fontSize:     12,
                fontWeight:   600,
                color:        "#8899b0",
                background:   "rgba(255,255,255,0.05)",
                border:       "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                cursor:       "pointer",
              }}
            >
              Back
            </button>
          )}
          <button
            onClick={() => navigate(1)}
            style={{
              flex:         1,
              display:      "flex",
              alignItems:   "center",
              justifyContent: "center",
              gap:          6,
              padding:      "7px 16px",
              fontSize:     12,
              fontWeight:   600,
              background:   "linear-gradient(135deg, #00c9ff, #0087d8)",
              color:        "#060c18",
              border:       "none",
              borderRadius: 8,
              cursor:       "pointer",
            }}
          >
            {step === STEPS.length - 1 ? "Finish" : "Next"}
            <ArrowRight size={12} />
          </button>
          <button
            onClick={completeTour}
            style={{
              padding:    "7px 12px",
              fontSize:   12,
              fontWeight: 600,
              color:      "#5a7294",
              background: "none",
              border:     "none",
              cursor:     "pointer",
            }}
          >
            Skip
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
