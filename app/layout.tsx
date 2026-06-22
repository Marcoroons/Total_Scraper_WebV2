import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { ProjectProvider } from "@/lib/context/ProjectContext";
import { AppShell } from "@/components/AppShell";

const inter = Inter({ subsets: ["latin"] });

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
        <body className={inter.className}>{children}</body>
      </html>
    );
  }

  /* Authenticated: full app shell */
  return (
    <html lang="en">
      <body className={inter.className}>
        <ProjectProvider>
          <AppShell email={user.email ?? ""}>
            {children}
          </AppShell>
        </ProjectProvider>
      </body>
    </html>
  );
}
