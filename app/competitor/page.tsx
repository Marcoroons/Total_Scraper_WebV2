import { TrendingUp } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export default function CompetitorPage() {
  return (
    <ComingSoon
      title="Competitor Analysis"
      description="Side-by-side benchmarking of brand presence, posting cadence, and audience engagement across accounts is on the way."
      icon={TrendingUp}
      accent="#fb923c"
    />
  );
}
