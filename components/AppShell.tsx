"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Bell,
  ChevronLeft,
  FileText,
  FolderOpen,
  Hash,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  Sparkles,
  TrendingUp,
  User,
  Users,
  Video,
  X,
  Timer,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ProjectSelector } from "@/components/ProjectSelector";

/* ── Nav structure matching Figma ── */
type NavItem = { href: string; label: string; icon: React.ElementType; tour?: string };
type NavGroup = { label?: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, tour: "dashboard" },
    ],
  },
  {
    label: "SCRAPERS",
    items: [
      { href: "/url-stats",       label: "Video URL Scraper",   icon: Video,         tour: "url-stats" },
      { href: "/profile-tracker", label: "Profile Scraper",     icon: User,          tour: "profile-tracker" },
      { href: "/comments",        label: "Comment Sentiment",   icon: MessageSquare, tour: "comments" },
      { href: "/hashtags",        label: "Hashtag / Trends",    icon: Hash,          tour: "hashtags" },
      { href: "/competitor",      label: "Competitor Analysis", icon: TrendingUp,    tour: "competitor" },
    ],
  },
  {
    label: "OPERATIONS",
    items: [
      { href: "/queue", label: "Queue & Export", icon: Timer, tour: "queue" },
    ],
  },
  {
    label: "TOOLS",
    items: [
      { href: "/nlp-settings", label: "NLP Settings",  icon: Settings,  tour: "nlp-settings" },
      { href: "/queue",        label: "Report Builder", icon: FileText,  tour: "report-builder" },
    ],
  },
  {
    label: "MANAGEMENT",
    items: [
      { href: "/teams",    label: "Teams",    icon: Users,      tour: "teams" },
      { href: "/projects", label: "Projects", icon: FolderOpen, tour: "projects" },
    ],
  },
];

/* Page title derived from pathname */
const TITLES: Record<string, string> = {
  "/dashboard":       "Dashboard",
  "/url-stats":       "Video URL Scraper",
  "/profile-tracker": "Profile Scraper",
  "/comments":        "Comment Sentiment",
  "/hashtags":        "Hashtag / Trends",
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
  const pathname = usePathname();
  const router   = useRouter();
  const [collapsed,   setCollapsed]   = useState(false);
  const [mobileOpen,  setMobileOpen]  = useState(false);

  const pageTitle = getTitle(pathname);
  const userInitials = initials(email);

  /* Close mobile drawer on navigation */
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  /* Ctrl/Cmd+B to toggle sidebar */
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
    <div className="flex h-screen overflow-hidden bg-background">

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ══════════════ SIDEBAR ══════════════ */}
      <aside
        style={{ width: collapsed ? "3.5rem" : "17rem" }}
        className={[
          "fixed inset-y-0 left-0 z-50 flex flex-col",
          "bg-sidebar border-r border-sidebar-border",
          "transition-[width] duration-200 ease-in-out",
          /* Mobile: slide in/out */
          mobileOpen ? "translate-x-0 shadow-card-lg" : "-translate-x-full",
          "md:relative md:z-auto md:translate-x-0 md:shadow-none",
          /* Mobile is always expanded */
          "w-[17rem]",
        ].join(" ")}
      >
        {/* ── Logo row ── */}
        <div className="flex items-center h-14 px-3 border-b border-sidebar-border gap-2 flex-shrink-0">
          <Link
            href="/dashboard"
            data-tour="logo"
            className={[
              "flex items-center gap-2.5 flex-1 min-w-0 overflow-hidden",
              collapsed ? "md:justify-center" : "",
            ].join(" ")}
          >
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center flex-shrink-0">
              <span className="text-[11px] font-bold text-primary leading-none">TS</span>
            </div>
            <span className={["text-sm font-semibold text-sidebar-foreground truncate", collapsed ? "md:hidden" : ""].join(" ")}>
              Total Scraper
            </span>
          </Link>

          {/* Desktop collapse toggle */}
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? "Expand (Ctrl+B)" : "Collapse (Ctrl+B)"}
            className="hidden md:flex w-6 h-6 items-center justify-center rounded text-sidebar-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors flex-shrink-0"
          >
            <ChevronLeft className={["w-4 h-4 transition-transform duration-200", collapsed ? "rotate-180" : ""].join(" ")} />
          </button>

          {/* Mobile close */}
          <button onClick={() => setMobileOpen(false)} className="md:hidden w-7 h-7 flex items-center justify-center rounded text-sidebar-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Project selector ── */}
        {!collapsed && (
          <div
            className="px-3 py-2.5 border-b border-sidebar-border flex-shrink-0"
            data-tour="project-selector"
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted-foreground mb-1.5 px-0.5">
              Active Project
            </p>
            <ProjectSelector />
          </div>
        )}

        {/* ── Navigation ── */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2" data-tour="nav">
          {NAV.map((group, gi) => (
            <div key={gi} className={gi > 0 ? "mt-2" : ""}>
              {/* Section header */}
              {group.label && (
                <p className={[
                  "px-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted-foreground select-none",
                  collapsed ? "md:hidden" : "pt-2",
                ].join(" ")}>
                  {group.label}
                </p>
              )}
              {/* Divider when collapsed */}
              {group.label && collapsed && <div className="h-px bg-sidebar-border mx-2 mt-2 mb-1" />}

              <div className="px-2 space-y-0.5">
                {group.items.map(({ href, label, icon: Icon, tour }) => {
                  const isActive = href === "/dashboard"
                    ? pathname === "/dashboard" || pathname === "/"
                    : pathname.startsWith(href) && label !== "Report Builder";
                  return (
                    <Link
                      key={`${href}-${label}`}
                      href={href}
                      title={collapsed ? label : undefined}
                      data-tour={tour}
                      className={[
                        "group flex items-center gap-2.5 py-1.5 rounded-md text-[13px] transition-all duration-150",
                        "border-l-2",
                        collapsed
                          ? "md:justify-center md:px-2 px-2.5 pl-[9px]"
                          : "px-2 pl-[7px]",
                        isActive
                          ? "bg-sidebar-active text-primary font-medium border-primary"
                          : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent border-transparent",
                      ].join(" ")}
                    >
                      <Icon className={[
                        "w-4 h-4 flex-shrink-0 transition-colors",
                        isActive ? "text-primary" : "group-hover:text-sidebar-foreground",
                      ].join(" ")} />
                      {(!collapsed || true) && (
                        <span className={["truncate", collapsed ? "md:hidden" : ""].join(" ")}>
                          {label}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* ── User at bottom ── */}
        <div className="flex-shrink-0 border-t border-sidebar-border px-3 py-3">
          {collapsed ? (
            <div className="flex justify-center">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-primary-foreground cursor-default">
                {userInitials}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary-foreground">
                {userInitials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-sidebar-foreground truncate leading-tight">{email}</p>
              </div>
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="w-6 h-6 flex items-center justify-center rounded text-sidebar-muted-foreground hover:text-primary transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ══════════════ MAIN AREA ══════════════ */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* ── Header ── */}
        <header className="h-14 flex-shrink-0 bg-card border-b border-border flex items-center px-5 gap-4">
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Page title */}
          <h1 className="text-[15px] font-semibold text-foreground flex-1 truncate">
            {pageTitle}
          </h1>

          {/* Right: Tour / Bell / Help */}
          <div className="flex items-center gap-1">
            <button
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
              data-tour="tour-trigger"
            >
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              Tour
            </button>
            <button className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Notifications">
              <Bell className="w-4 h-4" />
            </button>
            <button className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Help">
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* ── Page content ── */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
