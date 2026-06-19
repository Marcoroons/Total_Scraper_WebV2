import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import {
  BarChart2,
  Users,
  MessageSquare,
  Hash,
  Clock,
  LayoutDashboard,
  TrendingUp,
  Settings,
} from "lucide-react";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Total Scraper Web",
  description: "Indonesian FMCG Competitive Intelligence — Cimory",
};

const NAV_ITEMS = [
  { href: "/dashboard",       label: "Dashboard",       icon: LayoutDashboard },
  { href: "/url-stats",       label: "URL Stats",        icon: BarChart2 },
  { href: "/profile-tracker", label: "Profile Tracker",  icon: Users },
  { href: "/comments",        label: "Comments",         icon: MessageSquare },
  { href: "/hashtags",        label: "Hashtags",         icon: Hash },
  { href: "/queue",           label: "Queue & Export",   icon: Clock },
  { href: "/competitor",      label: "Competitor Intel", icon: TrendingUp },
  { href: "/nlp-settings",    label: "NLP Settings",     icon: Settings },
] as const;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="flex h-screen bg-gray-50">
          {/* Sidebar */}
          <aside className="w-64 flex-shrink-0 bg-[#1F4E78] text-white flex flex-col">
            <div className="p-6 border-b border-white/10">
              <h1 className="text-lg font-bold tracking-tight">Total Scraper</h1>
              <p className="text-xs text-blue-300 mt-1">Cimory Intel Platform</p>
            </div>

            <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm
                             font-medium text-blue-100 hover:bg-[#2E86AB] hover:text-white
                             transition-colors"
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{label}</span>
                </Link>
              ))}
            </nav>

            <div className="p-4 border-t border-white/10">
              <p className="text-xs font-medium text-white truncate">user@example.com</p>
              <p className="text-xs text-blue-400 mt-0.5">Personal Workspace</p>
            </div>
          </aside>

          {/* Main area */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <header className="bg-white border-b px-6 py-4 flex items-center
                               justify-between shadow-sm flex-shrink-0">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                  Active Project
                </p>
                <h2 className="text-base font-semibold text-gray-800 mt-0.5">
                  Select a project
                </h2>
              </div>
              <span className="text-sm text-gray-500">user@example.com</span>
            </header>

            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}