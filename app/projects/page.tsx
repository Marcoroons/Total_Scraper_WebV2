"use client";

import { useCallback, useEffect, useState } from "react";
import { Briefcase, Loader2, Plus, X } from "lucide-react";
import { useProject, type Project } from "@/lib/context/ProjectContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProjectStatus = "Active" | "Paused" | "Completed";

const STATUS_STYLE: Record<ProjectStatus, { bg: string; border: string; color: string }> = {
  Active:    { bg: "rgba(16,185,129,0.1)",  border: "rgba(16,185,129,0.25)",  color: "#10b981" },
  Paused:    { bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.25)",  color: "#f59e0b" },
  Completed: { bg: "rgba(20,184,166,0.1)",  border: "rgba(20,184,166,0.25)",  color: "#2dd4bf" },
};

interface RichProject extends Project {
  team_name: string | null;
  status: ProjectStatus;
}

const FILTER_TABS: Array<"All" | ProjectStatus> = ["All", "Active", "Paused", "Completed"];

// ─── Avatar helpers ───────────────────────────────────────────────────────────

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #0d7a8a, #00c9ff)",
  "linear-gradient(135deg, #7c3aed, #a78bfa)",
  "linear-gradient(135deg, #c2410c, #fb923c)",
  "linear-gradient(135deg, #0f766e, #2dd4bf)",
  "linear-gradient(135deg, #1d4ed8, #60a5fa)",
  "linear-gradient(135deg, #9d174d, #f472b6)",
  "linear-gradient(135deg, #065f46, #10b981)",
  "linear-gradient(135deg, #4c1d95, #8b5cf6)",
];

function avatarGradient(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
}

// ─── New Project Modal ────────────────────────────────────────────────────────

function NewProjectModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (project: Project) => void;
}) {
  const [name,     setName]     = useState("");
  const [teamId,   setTeamId]   = useState("");
  const [teams,    setTeams]    = useState<Array<{ team_id: string; team_name: string }>>([]);
  const [loading,  setLoading]  = useState(false);
  const [err,      setErr]      = useState("");

  useEffect(() => {
    fetch("/api/teams")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTeams(Array.isArray(data) ? data : []))
      .catch(() => setTeams([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_name: name.trim(), ...(teamId ? { team_id: teamId } : {}) }),
      });
      const body = await res.json();
      if (!res.ok) { setErr((body as { error?: string }).error ?? "Failed to create project"); return; }
      onCreate(body as Project);
      onClose();
    } catch {
      setErr("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6"
        style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>
            New project
          </h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
              Project name
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Campaign Q3 2026"
              className="w-full px-3 py-2.5 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {teams.length > 0 && (
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
                Share with
              </label>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="w-full px-3 py-2.5 text-sm rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Personal (only me)</option>
                {teams.map((t) => (
                  <option key={t.team_id} value={t.team_id}>{t.team_name} (whole team)</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1.5">
                Pick a team to share this project with everyone in it.
              </p>
            </div>
          )}
          {err && (
            <p className="text-sm rounded-lg px-3 py-2" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
              {err}
            </p>
          )}
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full py-2.5 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
          >
            {loading ? "Creating…" : "Create project"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const { activeProjectId, setActiveProject, refreshProjects } = useProject();
  const [projects,     setProjects]     = useState<RichProject[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState("");
  const [filter,       setFilter]       = useState<"All" | ProjectStatus>("All");
  const [showModal,    setShowModal]    = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Fetch projects + teams in parallel
      const [projRes, teamRes] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/teams").catch(() => null),
      ]);

      if (!projRes.ok) {
        const body = await projRes.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? "Failed to load projects");
        return;
      }

      const rawProjects: Project[] = await projRes.json();

      // Build team name lookup
      const teamNameById = new Map<string, string>();
      if (teamRes?.ok) {
        const teams: Array<{ team_id: string; team_name: string }> = await teamRes.json();
        for (const t of teams) teamNameById.set(t.team_id, t.team_name);
      }

      const rich: RichProject[] = rawProjects.map((p) => ({
        ...p,
        team_name: p.team_id ? (teamNameById.get(p.team_id) ?? null) : null,
        status: "Active" as ProjectStatus,
      }));

      setProjects(rich);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleCreate(project: Project) {
    setActiveProject(project);
    refreshProjects();
    load(); // reload so a team-shared project shows its team name immediately
  }

  function handleActivate(project: RichProject) {
    setActiveProject(project);
  }

  const filtered = filter === "All" ? projects : projects.filter((p) => p.status === filter);

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6">
        {/* Filter tabs */}
        <div className="flex gap-1.5">
          {FILTER_TABS.map((tab) => {
            const isActive = filter === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className="px-4 py-1.5 text-sm font-medium rounded-lg border transition-all"
                style={isActive ? {
                  background: "rgba(0,201,255,0.1)",
                  borderColor: "rgba(0,201,255,0.3)",
                  color: "#00c9ff",
                } : {
                  background: "transparent",
                  borderColor: "rgba(255,255,255,0.08)",
                  color: "#5a7294",
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
        >
          <Plus className="w-4 h-4" />
          New project
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Briefcase className="w-10 h-10 text-muted-foreground opacity-30 mb-4" />
          <p className="text-sm text-muted-foreground">
            {projects.length === 0
              ? "No projects yet. Create your first one."
              : `No ${filter.toLowerCase()} projects.`}
          </p>
          {projects.length === 0 && (
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
            >
              <Plus className="w-4 h-4" />
              New project
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((project) => {
            const isActive   = project.project_id === activeProjectId;
            const statusStyle = STATUS_STYLE[project.status];
            const letter     = project.project_name.charAt(0).toUpperCase();

            return (
              <button
                key={project.project_id}
                type="button"
                onClick={() => handleActivate(project)}
                className="rounded-xl border p-5 text-left transition-all hover:translate-y-[-2px] group"
                style={{
                  background:  isActive ? "rgba(0,201,255,0.04)" : "#0d1829",
                  borderColor: isActive ? "rgba(0,201,255,0.3)" : "rgba(255,255,255,0.07)",
                  boxShadow:   isActive ? "0 0 0 1px rgba(0,201,255,0.08), 0 4px 16px rgba(0,0,0,0.3)" : "none",
                }}
              >
                {/* Top row */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ background: avatarGradient(project.project_id) }}
                    >
                      {letter}
                    </div>
                    <div>
                      <p
                        className="text-sm font-bold text-foreground leading-tight"
                        style={{ fontFamily: "Outfit, sans-serif" }}
                      >
                        {project.project_name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {project.team_name ?? "Personal"}
                      </p>
                    </div>
                  </div>

                  <span
                    className="text-[11px] font-medium px-2.5 py-1 rounded-md border flex-shrink-0"
                    style={{ background: statusStyle.bg, borderColor: statusStyle.border, color: statusStyle.color }}
                  >
                    {project.status}
                  </span>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                  <div className="flex items-center gap-1.5">
                    {isActive && (
                      <span
                        className="text-[10px] font-mono px-2 py-0.5 rounded"
                        style={{ background: "rgba(0,201,255,0.1)", color: "#00c9ff", border: "1px solid rgba(0,201,255,0.2)" }}
                      >
                        Active context
                      </span>
                    )}
                  </div>
                  {!isActive && (
                    <span className="text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                      Click to switch →
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {showModal && (
        <NewProjectModal
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
