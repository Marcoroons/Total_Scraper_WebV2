"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// NLP Settings moved under Comment Sentiment Analysis as a subtab.
// Keep this route working for old links by redirecting there.
export default function NlpSettingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/comments?tab=nlp");
  }, [router]);
  return (
    <div className="p-8 text-sm text-muted-foreground">Redirecting to Comment Sentiment → NLP Settings…</div>
  );
}
