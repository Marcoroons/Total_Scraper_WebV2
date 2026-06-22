"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FolderOpen, Plus, Users, X } from "lucide-react";
import { useProject, type Project } from "@/lib/context/ProjectContext";
import { TeamMembersList } from "@/components/TeamMembersList";

export function ProjectSelector() {
  const {
    activeProjectId,
    activeProjectName,
    availableProjects,
    setActiveProject,
    refreshProjects,
  } = useProject();

  const [open,     setOpen]     = useState(false);
  const [showNew,  setShowNew]  = useState(false);
  const [newName,  setNewName]  = useState("");
  const [creating, setCreating] = useState(false);
  const [err,      setErr]      = useState("");
  const [showTeam, setShowTeam] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setErr("");

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_name: newName.trim() }),
    });

    if (!res.ok) {
      const body = await res.json();
      setErr(body.error ?? "Failed to create project.");
      setCreating(false);
      return;
    }

    const newProject: Project = await res.json();
    await refreshProjects();
    setActiveProject(newProject);
    setNewName("");
    setShowNew(false);
    setOpen(false);
    setCreating(false);
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 w-full text-left group"
      >
        <FolderOpen className="w-3.5 h-3.5 text-sidebar-muted-foreground flex-shrink-0" />
        <span className="flex-1 text-[13px] font-medium text-sidebar-foreground truncate group-hover:text-primary transition-colors">
          {activeProjectName ?? "Select a project"}
        </span>
        <ChevronDown className={[
          "w-3.5 h-3.5 text-sidebar-muted-foreground transition-transform duration-150 flex-shrink-0",
          open ? "rotate-180" : "",
        ].join(" ")} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-popover border border-border rounded-lg shadow-card-lg z-[60]">
          <div className="py-1 max-h-56 overflow-y-auto">
            {availableProjects.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground italic">No projects yet.</p>
            ) : (
              availableProjects.map((p) => (
                <button
                  key={p.project_id}
                  onClick={() => { setActiveProject(p); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
                >
                  <FolderOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="flex-1 truncate">{p.project_name}</span>
                  {p.project_id === activeProjectId && (
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>

          <div className="border-t border-border">
            {activeProjectId && !showNew && (
              <button
                onClick={() => { setShowTeam(true); setOpen(false); }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-foreground font-medium hover:bg-muted transition-colors border-b border-border"
              >
                <Users className="w-4 h-4 text-muted-foreground" />
                Manage Team
              </button>
            )}
            {!showNew ? (
              <button
                onClick={() => setShowNew(true)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-primary font-medium hover:bg-muted transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Project
              </button>
            ) : (
              <form onSubmit={handleCreate} className="p-3 space-y-2">
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Project name"
                  className="w-full px-2.5 py-1.5 bg-input border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {err && <p className="text-xs text-destructive">{err}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={creating || !newName.trim()}
                    className="flex-1 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-md hover:bg-primary/90 disabled:opacity-60 transition-colors"
                  >
                    {creating ? "Creating…" : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowNew(false); setNewName(""); setErr(""); }}
                    className="px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Manage Team modal */}
      {showTeam && activeProjectId && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowTeam(false)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-card-lg w-full max-w-lg max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between px-5 py-4 border-b border-border">
              <div>
                <h2 className="text-base font-bold text-foreground">Manage Team</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{activeProjectName}</p>
              </div>
              <button
                onClick={() => setShowTeam(false)}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <TeamMembersList projectId={activeProjectId} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
