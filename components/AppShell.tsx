"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  Brain,
  ChevronLeft,
  Clock,
  Database,
  FolderOpen,
  Hash,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Sparkles,
  TrendingUp,
  User,
  Users,
  Video,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useProject } from "@/lib/context/ProjectContext";
import { AppTour } from "@/components/AppTour";

/* ── Nav structure matching Figma exactly ── */
type NavItem = { href: string; label: string; icon: React.ElementType; color: string };
type NavSection = { label?: string; items: NavItem[] };

const NAV: NavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, color: "#00c9ff" },
    ],
  },
  {
    label: "SCRAPERS",
    items: [
      { href: "/url-stats",       label: "Video URL Scraper",   icon: Video,         color: "#f59e0b" },
      { href: "/profile-tracker", label: "Profile Scraper",     icon: User,          color: "#a78bfa" },
      { href: "/comments",        label: "Comment Sentiment",   icon: MessageSquare, color: "#f472b6" },
      { href: "/hashtags",        label: "Hashtag / Trends",    icon: Hash,          color: "#2dd4bf" },
      { href: "/competitor",      label: "Competitor Analysis", icon: TrendingUp,    color: "#fb923c" },
    ],
  },
  {
    label: "OPERATIONS",
    items: [
      { href: "/queue", label: "Queue & Export", icon: Clock, color: "#00c9ff" },
    ],
  },
  {
    label: "TOOLS",
    items: [
      { href: "/nlp-settings", label: "NLP Settings", icon: Brain, color: "#f472b6" },
    ],
  },
  {
    label: "MANAGEMENT",
    items: [
      { href: "/teams",    label: "Teams",    icon: Users,      color: "#7c3aed" },
      { href: "/projects", label: "Projects", icon: FolderOpen, color: "#10b981" },
    ],
  },
];

const TITLES: Record<string, string> = {
  "/dashboard":       "Dashboard",
  "/url-stats":       "Video URL Scraper",
  "/profile-tracker": "Profile Scraper",
  "/comments":        "Comment Sentiment Analysis",
  "/hashtags":        "Hashtag / Trend Analysis",
  "/queue":           "Queue & Export",
  "/competitor":      "Competitor Analysis",
  "/nlp-settings":    "NLP Settings",
  "/teams":           "Teams",
  "/projects":        "Projects",
};

function getTitle(pathname: string) {
  for (const [path, title] of Object.entries(TITLES)) {
    if (pathname.startsWith(path)) return title;
  }
  return "Total Scraper";
}

function initials(email: string) {
  const name = email.split("@")[0];
  const parts = name.split(/[._\-+]/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || name.slice(0, 2).toUpperCase();
}

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname   = usePathname();
  const router     = useRouter();
  const { activeProjectName } = useProject();
  const [collapsed,  setCollapsed]  = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const pageTitle    = getTitle(pathname);
  const userInitials = initials(email);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        setCollapsed(c => !c);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#060c18" }}>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ══════════════ SIDEBAR ══════════════ */}
      <aside
        style={{
          width: collapsed ? 56 : 236,
          background: "#070d1a",
          borderRight: "1px solid rgba(255,255,255,0.06)",
        }}
        className={[
          "flex flex-col h-full transition-[width] duration-300 overflow-hidden flex-shrink-0",
          "fixed inset-y-0 left-0 z-50",
          mobileOpen ? "translate-x-0 shadow-xl" : "-translate-x-full",
          "md:relative md:z-auto md:translate-x-0 md:shadow-none",
        ].join(" ")}
      >

        {/* ── Logo ── */}
        <div
          className="flex items-center justify-between px-3 py-3.5 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          data-tour="logo"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #00c9ff, #7c3aed)" }}
            >
              <Database className="w-3.5 h-3.5 text-white" />
            </div>
            {!collapsed && (
              <span className="text-sm font-semibold tracking-tight truncate" style={{ color: "#dde4f4" }}>
                Total Scraper
              </span>
            )}
          </div>

          {/* Desktop collapse */}
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse (Ctrl+B)"
              className="hidden md:flex w-5 h-5 items-center justify-center rounded opacity-30 hover:opacity-80 transition-opacity flex-shrink-0"
            >
              <ChevronLeft className="w-3 h-3" style={{ color: "#94a3b8" }} />
            </button>
          )}
          {collapsed && (
            <button
              onClick={() => setCollapsed(false)}
              title="Expand (Ctrl+B)"
              className="hidden md:flex items-center justify-center w-full py-0.5 opacity-30 hover:opacity-80 transition-opacity"
            >
              <Menu className="w-4 h-4" style={{ color: "#94a3b8" }} />
            </button>
          )}

          {/* Mobile close */}
          <button onClick={() => setMobileOpen(false)} className="md:hidden w-7 h-7 flex items-center justify-center rounded opacity-50">
            <X className="w-4 h-4" style={{ color: "#94a3b8" }} />
          </button>
        </div>

        {/* ── Active project indicator ── */}
        {!collapsed && (
          <div
            className="px-2.5 py-2.5 flex-shrink-0"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            data-tour="project-selector"
          >
            <Link
              href="/projects"
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors hover:bg-white/5"
            >
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#00c9ff" }} />
              <span className="font-mono text-[10px] uppercase tracking-wider flex-shrink-0" style={{ color: "#3a4d68" }}>
                Project
              </span>
              <span className="text-xs font-medium truncate" style={{ color: "#c8d8ed" }}>
                {activeProjectName ?? "Select project"}
              </span>
            </Link>
          </div>
        )}

        {/* ── Navigation ── */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-2" data-tour="nav">
          {NAV.map((section, si) => (
            <div key={si} className={si > 0 ? "mt-1" : ""}>
              {/* Section divider label */}
              {section.label && !collapsed && (
                <div className="pt-3 pb-0.5 px-1">
                  <span
                    className="text-[10px] font-mono uppercase tracking-widest"
                    style={{ color: "#283d58" }}
                  >
                    {section.label}
                  </span>
                </div>
              )}
              {section.label && collapsed && (
                <div className="h-px mx-2 mt-3 mb-1" style={{ background: "rgba(255,255,255,0.06)" }} />
              )}

              {/* Items */}
              <div className="space-y-[1px]">
                {section.items.map(({ href, label, icon: Icon, color }) => {
                  const isActive = href === "/dashboard"
                    ? pathname === "/dashboard" || pathname === "/"
                    : pathname.startsWith(href) && label !== "Report Builder";

                  return (
                    <Link
                      key={`${href}-${label}`}
                      href={href}
                      title={collapsed ? label : undefined}
                      data-tour={label.toLowerCase().replace(/\s+/g, "-")}
                      className={[
                        "flex items-center gap-2.5 py-1.5 rounded text-xs font-medium tracking-tight transition-all duration-150",
                        collapsed ? "justify-center px-1.5" : "px-2.5",
                      ].join(" ")}
                      style={isActive ? {
                        background: `${color}12`,
                        borderLeft: collapsed ? undefined : `2px solid ${color}`,
                        paddingLeft: collapsed ? undefined : "calc(0.625rem - 2px)",
                        color,
                      } : {
                        color: "#8899b0",
                      }}
                      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLAnchorElement).style.color = color; }}
                      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLAnchorElement).style.color = "#8899b0"; }}
                    >
                      <div
                        className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-all duration-150"
                        style={isActive ? { background: `${color}20` } : {}}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      {!collapsed && <span>{label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* ── User ── */}
        <div
          className="flex-shrink-0 p-3"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          {collapsed ? (
            <div className="flex justify-center">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold cursor-default"
                style={{ background: "rgba(0,201,255,0.12)", color: "#00c9ff" }}
              >
                {userInitials}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
                style={{ background: "rgba(0,201,255,0.12)", color: "#00c9ff" }}
              >
                {userInitials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate leading-tight" style={{ color: "#dde4f4" }}>
                  {email.split("@")[0]}
                </div>
                <div className="text-[10px] truncate" style={{ color: "#5a7294" }}>{email}</div>
              </div>
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="opacity-30 hover:opacity-80 transition-opacity flex-shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" style={{ color: "#94a3b8" }} />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ══════════════ MAIN AREA ══════════════ */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* ── Top bar ── */}
        <header
          className="h-12 flex-shrink-0 flex items-center justify-between px-6"
          style={{ background: "#070d1a", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden w-7 h-7 flex items-center justify-center rounded opacity-50 hover:opacity-80 transition-opacity"
            >
              <Menu className="w-4 h-4" style={{ color: "#94a3b8" }} />
            </button>
            <h1 className="text-sm font-semibold" style={{ color: "#dde4f4" }}>
              {pageTitle}
            </h1>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => window.dispatchEvent(new Event("ts:start-tour"))}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-mono border transition-all hover:border-[rgba(0,201,255,0.3)] hover:text-[#00c9ff]"
              style={{ borderColor: "rgba(255,255,255,0.07)", color: "#5a7294" }}
              data-tour="tour-trigger"
            >
              <Sparkles className="w-3 h-3" style={{ color: "#00c9ff" }} />
              Tour
            </button>
            <button
              className="relative w-8 h-8 flex items-center justify-center rounded transition-colors hover:bg-white/5"
              title="Notifications"
            >
              <Bell className="w-4 h-4" style={{ color: "#5a7294" }} />
              <span
                className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                style={{ background: "#00c9ff" }}
              />
            </button>
            <button
              className="w-8 h-8 flex items-center justify-center rounded transition-colors hover:bg-white/5"
              title="Help"
            >
              <HelpCircle className="w-4 h-4" style={{ color: "#5a7294" }} />
            </button>
          </div>
        </header>

        {/* ── Page content ── */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>

      {/* ── Onboarding tour (portal, renders above everything) ── */}
      <AppTour />
    </div>
  );
}
