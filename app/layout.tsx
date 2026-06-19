import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import {
  Building2,
  Hash,
  LayoutDashboard,
  Link2,
  ListOrdered,
  MessageSquare,
  Sliders,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ProjectProvider } from "@/lib/context/ProjectContext";
import { ProjectSelector } from "@/components/ProjectSelector";
import { UserMenu } from "@/components/UserMenu";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Total Scraper",
  description: "Cimory Intel Platform",
};

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/url-stats", label: "URL Stats", icon: Link2 },
  { href: "/profile-tracker", label: "Profile Tracker", icon: Users },
  { href: "/comments", label: "Comments", icon: MessageSquare },
  { href: "/hashtags", label: "Hashtags", icon: Hash },
  { href: "/queue", label: "Queue", icon: ListOrdered },
  { href: "/competitor", label: "Competitor", icon: Building2 },
  { href: "/nlp-settings", label: "NLP Settings", icon: Sliders },
];

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <html lang="en">
        <body className={inter.className}>{children}</body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body className={inter.className}>
        <ProjectProvider>
          <div className="flex h-screen overflow-hidden bg-gray-50">
            <aside className="w-56 flex-shrink-0 bg-[#1F4E78] text-white flex flex-col">
              <div className="px-5 py-5 border-b border-white/10">
                <h1 className="text-base font-bold tracking-tight">Total Scraper</h1>
                <p className="text-[10px] text-blue-200 mt-0.5 uppercase tracking-widest">
                  Cimory Intel
                </p>
              </div>
              <nav className="flex-1 py-4 overflow-y-auto">
                {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-3 px-5 py-2.5 text-sm text-blue-100 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {label}
                  </Link>
                ))}
              </nav>
            </aside>

            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
              <header className="h-14 flex-shrink-0 bg-white border-b flex items-center px-6 gap-4">
                <div className="flex-1">
                  <ProjectSelector />
                </div>
                <UserMenu email={user.email ?? ""} />
              </header>
              <main className="flex-1 overflow-y-auto p-6">{children}</main>
            </div>
          </div>
        </ProjectProvider>
      </body>
    </html>
  );
}