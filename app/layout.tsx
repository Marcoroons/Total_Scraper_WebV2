import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { ProjectProvider } from "@/lib/context/ProjectContext";
import { AppShell } from "@/components/AppShell";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

export const metadata: Metadata = {
  title: "Total Scraper",
  description: "Cimory Intel Platform — Competitive Intelligence for Indonesian FMCG",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  /* Unauthenticated: render bare shell (login / signup / landing / terms) */
  if (!user) {
    return (
      <html lang="en">
        <body className={`${inter.variable} ${outfit.variable} font-sans`}>{children}</body>
      </html>
    );
  }

  /* Authenticated: full app shell */
  return (
    <html lang="en">
      <body className={`${inter.variable} ${outfit.variable} font-sans`}>
        <ProjectProvider>
          <AppShell email={user.email ?? ""}>
            {children}
          </AppShell>
        </ProjectProvider>
      </body>
    </html>
  );
}
