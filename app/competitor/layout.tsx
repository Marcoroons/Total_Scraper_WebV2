import { PasswordGate } from "@/components/PasswordGate";

// Wraps the Competitor Analysis page in an admin-only gate. Nests inside
// the app-wide layout, so the gate renders within the normal chrome (nav
// + AppShell). Client-side barrier — see PasswordGate.tsx for the trust
// model note.
export default function CompetitorLayout({ children }: { children: React.ReactNode }) {
  return (
    <PasswordGate
      storageKey="competitor_admin"
      password="MARCOH88"
      title="Competitor Analysis — admin only"
      subtitle="This section shows sensitive competitor pricing and sourcing data. Enter the admin password to continue."
    >
      {children}
    </PasswordGate>
  );
}
