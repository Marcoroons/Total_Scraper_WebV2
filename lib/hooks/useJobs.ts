"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export interface EcomJobConfig {
  platforms: ("Shopee" | "Tokopedia")[];
  search_mode: "keyword" | "shop";
  keywords?: string[];
  shop_targets?: string[];
  official_store_filter: "all" | "official_only" | "non_official_only";
  brand_names: string[];
  max_listings_per_platform: number;
}

export interface Job {
  job_id: string;
  project_id: string;
  target_url: string;
  platform: string;
  job_type: string;
  kol_username: string;
  rate: string;
  raw_metrics: string[];
  calc_metrics: string[];
  format_filter: string;
  target_limit: number;
  status: "PENDING" | "AUTO_PROCESSING" | "COMPLETED" | "FAILED";
  date_from: string;
  date_to: string;
  apify_api_key?: string;
  error_message?: string;
  created_at: string;
  ecom_config?: EcomJobConfig | null;
}

export interface JobFilters {
  status?: string;
  job_type?: string;
  sort?: "asc" | "desc";
}

export interface JobPayload {
  project_id: string;
  target_url: string;
  platform: string;
  job_type: string;
  kol_username?: string;
  rate?: string;
  raw_metrics?: string[];
  calc_metrics?: string[];
  format_filter?: string;
  target_limit?: number;
  date_from?: string;
  date_to?: string;
  apify_api_key?: string;
  max_retries?: number;
  date_multiplier?: number;
  fetch_followers?: boolean;
  ecom_config?: EcomJobConfig;
}

export function useJobs(projectId: string | null, filters: JobFilters = {}) {
  const { status, job_type, sort } = filters;

  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refetch = useCallback(async () => {
    if (!projectId) { setJobs([]); return; }
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ project_id: projectId });
      if (status) params.set("status", status);
      if (job_type) params.set("job_type", job_type);
      if (sort) params.set("sort", sort);
      const res = await fetch(`/api/jobs?${params}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load jobs");
      setJobs(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setIsLoading(false);
    }
  }, [projectId, status, job_type, sort]);

  useEffect(() => { refetch(); }, [refetch]);

  useEffect(() => {
    if (!projectId) return;
    const supabase = createClient();
    channelRef.current?.unsubscribe();

    const channel = supabase
      .channel(`jobs:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "scrape_jobs",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => setJobs((prev) => [payload.new as Job, ...prev])
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "scrape_jobs",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) =>
          setJobs((prev) =>
            prev.map((j) =>
              j.job_id === (payload.new as Job).job_id ? (payload.new as Job) : j
            )
          )
      )
      .subscribe();

    channelRef.current = channel;
    return () => { channel.unsubscribe(); };
  }, [projectId]);

  const createJobs = useCallback(async (payload: JobPayload[]) => {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobs: payload }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create jobs");
    return res.json();
  }, []);

  const cancelJob = useCallback(async (id: string) => {
    const res = await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "FAILED", error_message: "Cancelled by user" }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to cancel job");
  }, []);

  const retryJob = useCallback(async (id: string) => {
    const res = await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PENDING", error_message: null }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to retry job");
  }, []);

  const deleteJobs = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const res = await fetch("/api/jobs", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to delete jobs");
    // Realtime only streams INSERT/UPDATE, so drop the deleted rows locally.
    setJobs((prev) => prev.filter((j) => !ids.includes(j.job_id)));
  }, []);

  return { jobs, isLoading, error, refetch, createJobs, cancelJob, retryJob, deleteJobs };
}