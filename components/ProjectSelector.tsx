"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FolderOpen, Plus } from "lucide-react";
import { useProject, type Project } from "@/lib/context/ProjectContext";

export function ProjectSelector() {
  const {
    activeProjectId,
    activeProjectName,
    availableProjects,
    setActiveProject,
    refreshProjects,
  } = useProject();

  const [open, setOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
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
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 group text-left"
      >
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 leading-none mb-0.5">
            Active Project
          </p>
          <p className="text-sm font-semibold text-gray-800 group-hover:text-[#1F4E78] transition-colors flex items-center gap-1">
            {activeProjectName ?? "Select a project"}
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </p>
        </div>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-xl border shadow-lg z-50">
          <div className="py-1.5 max-h-56 overflow-y-auto">
            {availableProjects.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-400 italic">No projects yet.</p>
            ) : (
              availableProjects.map((p) => (
                <button
                  key={p.project_id}
                  onClick={() => {
                    setActiveProject(p);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                >
                  <FolderOpen className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="flex-1 truncate">{p.project_name}</span>
                  {p.project_id === activeProjectId && (
                    <Check className="w-4 h-4 text-[#1F4E78] flex-shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>

          <div className="border-t">
            {!showNew ? (
              <button
                onClick={() => setShowNew(true)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[#1F4E78] font-medium hover:bg-blue-50 transition-colors"
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
                  className="w-full px-2.5 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1F4E78]"
                />
                {err && <p className="text-xs text-red-500">{err}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={creating || !newName.trim()}
                    className="flex-1 py-1.5 bg-[#1F4E78] text-white text-xs font-semibold rounded-lg hover:bg-[#2E86AB] disabled:opacity-60 transition-colors"
                  >
                    {creating ? "Creating…" : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNew(false);
                      setNewName("");
                      setErr("");
                    }}
                    className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}