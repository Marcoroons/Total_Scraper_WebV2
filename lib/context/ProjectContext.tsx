"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface Project {
  project_id: string;
  project_name: string;
  user_id: string | null;
  team_id: string | null;
}

interface ProjectContextValue {
  activeProjectId: string | null;
  activeProjectName: string | null;
  availableProjects: Project[];
  setActiveProject: (project: Project) => void;
  refreshProjects: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const LS_KEY = "totalScraper:activeProjectId";

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [availableProjects, setAvailableProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectName, setActiveProjectName] = useState<string | null>(null);

  const refreshProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (!res.ok) return;
    const projects: Project[] = await res.json();
    setAvailableProjects(projects);

    const storedId = localStorage.getItem(LS_KEY);
    const restored = projects.find((p) => p.project_id === storedId);
    if (restored) {
      setActiveProjectId(restored.project_id);
      setActiveProjectName(restored.project_name);
    } else if (projects.length > 0) {
      setActiveProjectId(projects[0].project_id);
      setActiveProjectName(projects[0].project_name);
      localStorage.setItem(LS_KEY, projects[0].project_id);
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  const setActiveProject = useCallback((project: Project) => {
    setActiveProjectId(project.project_id);
    setActiveProjectName(project.project_name);
    localStorage.setItem(LS_KEY, project.project_id);
  }, []);

  return (
    <ProjectContext.Provider
      value={{
        activeProjectId,
        activeProjectName,
        availableProjects,
        setActiveProject,
        refreshProjects,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used inside <ProjectProvider>");
  return ctx;
}