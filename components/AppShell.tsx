"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Building2,
  ChevronLeft,
  Hash,
  LayoutDashboard,
  Link2,
  ListOrdered,
  Menu,
  MessageSquare,
  Sliders,
  Users,
  X,
} from "lucide-react";
import { ProjectSelector } from "@/components/ProjectSelector";
import { UserMenu } from "@/components/UserMenu";

const NAV = [
  { href: "/dashboard",       label: "Dashboard",       icon: LayoutDashboard, tour: "dashboard" },
  { href: "/profile-tracker", label: "Profile Tracker", icon: Users,           tour: "profile-tracker" },
  { href: "/url-stats",       label: "URL Stats",        icon: Link2,           tour: "url-stats" },
  { href: "/comments",        label: "Comments",         icon: MessageSquare,   tour: "comments" },
  { href: "/hashtags",        label: "Hashtags",         icon: Hash,            tour: "hashtags" },
  { href: "/queue",           label: "Queue",            icon: ListOrdered,     tour: "queue" },
  { href: "/competitor",      label: "Competitor",       icon: Building2,       tour: "competitor" },
  { href: "/nlp-settings",    label: "NLP Settings",     icon: Sliders,         tour: "nlp-settings" },
] as const;

export function AppShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 flex flex-col bg-sidebar border-r border-sidebar-border",
          "transition-all duration-200 ease-in-out w-60",
          mobileOpen ? "translate-x-0 shadow-card-lg" : "-translate-x-full",
          "md:relative md:z-auto md:translate-x-0 md:shadow-none",
          collapsed ? "md:w-[3.5rem]" : "md:w-60",
        ].join(" ")}
      >
        {/* Logo row */}
        <div className="flex items-center h-14 px-3 border-b border-sidebar-border flex-shrink-0 gap-2">
          <Link
            href="/dashboard"
            data-tour="logo"
            className={[
              "flex items-center gap-2.5 flex-1 min-w-0",
              collapsed ? "md:justify-center" : "",
            ].join(" ")}
          >
            <div className="w-7 h-7 rounded-lg bg-white/15 flex items-center justify-center flex-shrink-0">
              <span className="text-[11px] font-bold text-white leading-none">TS</span>
            </div>
            {!collapsed && (
              <div className="min-w-0 hidden md:block">
                <p className="text-sm font-bold text-sidebar-foreground leading-tight truncate">
                  Total Scraper
                </p>
                <p className="text-[9px] text-sidebar-muted-foreground uppercase tracking-widest leading-tight">
                  Cimory Intel
                </p>
              </div>
            )}
            {/* Always show name on mobile */}
            <div className="min-w-0 md:hidden">
              <p className="text-sm font-bold text-sidebar-foreground leading-tight truncate">
                Total Scraper
              </p>
              <p className="text-[9px] text-sidebar-muted-foreground uppercase tracking-widest leading-tight">
                Cimory Intel
              </p>
            </div>
          </Link>

          {/* Desktop collapse toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand (Ctrl+B)" : "Collapse (Ctrl+B)"}
            className="hidden md:flex w-6 h-6 items-center justify-center rounded text-sidebar-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors flex-shrink-0"
          >
            <ChevronLeft
              className={[
                "w-3.5 h-3.5 transition-transform duration-200",
                collapsed ? "rotate-180" : "",
              ].join(" ")}
            />
          </button>

          {/* Mobile close */}
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden flex w-7 h-7 items-center justify-center rounded text-sidebar-muted-foreground hover:text-sidebar-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden" data-tour="nav">
          <div className="px-2 space-y-0.5">
            {NAV.map(({ href, label, icon: Icon, tour }, idx) => {
              const isActive = pathname.startsWith(href);
              const showDivider = idx === 7; /* before NLP Settings */
              return (
                <div key={href}>
                  {showDivider && (
                    <div className="h-px bg-sidebar-border mx-1 my-2" />
                  )}
                  <Link
                    href={href}
                    title={collapsed ? label : undefined}
                    data-tour={tour}
                    className={[
                      "flex items-center gap-3 px-2.5 py-2 rounded-lg text-[13px] transition-colors",
                      collapsed ? "md:justify-center md:px-2" : "",
                      isActive
                        ? "bg-white/15 text-sidebar-foreground font-semibold"
                        : "text-sidebar-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent",
                    ].join(" ")}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {!collapsed && <span className="truncate">{label}</span>}
                    {/* Mobile always shows label */}
                    {collapsed && <span className="truncate md:hidden">{label}</span>}
                  </Link>
                </div>
              );
            })}
          </div>
        </nav>

        {/* Sidebar footer */}
        <div
          className={[
            "px-3 py-2.5 border-t border-sidebar-border flex-shrink-0",
            collapsed ? "md:hidden" : "",
          ].join(" ")}
        >
          <p className="text-[10px] text-sidebar-muted-foreground truncate">
            v2 · Cimory FMCG Intel
          </p>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-14 flex-shrink-0 bg-card border-b flex items-center px-4 gap-3">
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Open sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex-1 min-w-0" data-tour="project-selector">
            <ProjectSelector />
          </div>

          <UserMenu email={email} />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
