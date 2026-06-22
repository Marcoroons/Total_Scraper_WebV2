"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Loader2, MoreHorizontal, Plus, Send, Trash2, X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Team {
  team_id: string;
  team_name: string;
  member_count: number;
  project_count: number;
  my_role: string;
  created_at: string;
}

interface Member {
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
}

interface PendingInvite {
  email: string;
  role: string;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_OPTIONS = ["Admin", "Analyst", "Editor", "Viewer"];

const ROLE_STYLE: Record<string, { bg: string; border: string; color: string }> = {
  admin:   { bg: "rgba(0,201,255,0.08)",   border: "rgba(0,201,255,0.25)",   color: "#00c9ff" },
  analyst: { bg: "rgba(167,139,250,0.08)", border: "rgba(167,139,250,0.25)", color: "#a78bfa" },
  editor:  { bg: "rgba(251,146,60,0.08)",  border: "rgba(251,146,60,0.25)",  color: "#fb923c" },
  viewer:  { bg: "rgba(90,114,148,0.12)",  border: "rgba(90,114,148,0.3)",   color: "#8899b0" },
  member:  { bg: "rgba(90,114,148,0.12)",  border: "rgba(90,114,148,0.3)",   color: "#8899b0" },
};

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

function displayName(email: string, full_name: string | null) {
  if (full_name) return full_name;
  const prefix = email.split("@")[0];
  return prefix.split(/[._\-+]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

function initials(email: string, full_name: string | null) {
  if (full_name) {
    return full_name.split(/\s+/).map((p) => p[0]).join("").toUpperCase().slice(0, 2);
  }
  const parts = email.split("@")[0].split(/[._\-+]/);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("").slice(0, 2) || "?";
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-SG", { month: "short", year: "numeric" });
}

// ─── TeamDetail ───────────────────────────────────────────────────────────────

function TeamDetail({ team, currentUserId, onMemberChange }: {
  team: Team;
  currentUserId: string | null;
  onMemberChange: () => void;
}) {
  const uid = useId();
  const [members,  setMembers]  = useState<Member[]>([]);
  const [pending,  setPending]  = useState<PendingInvite[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");
  const [invEmail, setInvEmail] = useState("");
  const [invRole,  setInvRole]  = useState("Analyst");
  const [inviting, setInviting] = useState(false);
  const [invErr,   setInvErr]   = useState("");
  const [invOk,    setInvOk]    = useState("");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/teams/${team.team_id}/members`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Failed to load members");
        return;
      }
      const data = await res.json() as { members: Member[]; pending: PendingInvite[] };
      setMembers(data.members);
      setPending(data.pending ?? []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [team.team_id]);

  useEffect(() => { load(); }, [load]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!invEmail.trim()) return;
    setInviting(true);
    setInvErr("");
    setInvOk("");
    try {
      const res = await fetch(`/api/teams/${team.team_id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: invEmail.trim(), role: invRole.toLowerCase() }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string; pending?: boolean };
      if (!res.ok) { setInvErr(body.error ?? "Invite failed"); return; }
      setInvOk(body.pending
        ? `Invite saved — ${invEmail} will join when they sign up.`
        : `${invEmail} added as ${invRole}.`
      );
      setInvEmail("");
      await load();
      onMemberChange();
    } catch {
      setInvErr("Network error");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(member: Member) {
    if (!confirm(`Remove ${member.email} from this team?`)) return;
    setRemoving(member.user_id);
    try {
      await fetch(`/api/teams/${team.team_id}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: member.user_id }),
      });
      await load();
      onMemberChange();
    } finally {
      setRemoving(null);
      setOpenMenu(null);
    }
  }

  async function handleCancelInvite(email: string) {
    await fetch(`/api/teams/${team.team_id}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    await load();
  }

  const roleStyle = (role: string) => ROLE_STYLE[role.toLowerCase()] ?? ROLE_STYLE.member;

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 flex-shrink-0">
        <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>
          {team.team_name}
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">{team.member_count} members</p>
      </div>

      {/* Invite form */}
      <div className="px-6 pb-4 flex-shrink-0 border-b border-border">
        <form onSubmit={handleInvite} className="flex gap-2">
          <input
            type="email"
            value={invEmail}
            onChange={(e) => setInvEmail(e.target.value)}
            placeholder="colleague@company.com"
            className="flex-1 px-3 py-2 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <select
            value={invRole}
            onChange={(e) => setInvRole(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {ROLE_OPTIONS.map((r) => <option key={r}>{r}</option>)}
          </select>
          <button
            type="submit"
            disabled={inviting || !invEmail.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
          >
            <Send className="w-3.5 h-3.5" />
            Invite
          </button>
        </form>
        {invErr && (
          <p className="mt-2 text-xs" style={{ color: "#ef4444" }}>{invErr}</p>
        )}
        {invOk && (
          <p className="mt-2 text-xs" style={{ color: "#10b981" }}>{invOk}</p>
        )}
      </div>

      {/* Member list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="m-6 rounded-xl p-4 text-sm" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
            {error}
          </div>
        ) : members.length === 0 && pending.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">No members yet. Invite someone above.</p>
        ) : (
          <div className="divide-y divide-border">
            {members.map((m) => {
              const name  = displayName(m.email, m.full_name);
              const inits = initials(m.email, m.full_name);
              const rs    = roleStyle(m.role);
              const isSelf = m.user_id === currentUserId;
              return (
                <div key={m.user_id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-muted/40 transition-colors group">
                  {/* Avatar */}
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ background: avatarGradient(m.user_id) }}
                  >
                    {inits}
                  </div>

                  {/* Name + email */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {name}{isSelf && <span className="ml-1.5 text-[10px] text-muted-foreground">(you)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                  </div>

                  {/* Role badge */}
                  <span
                    className="text-[11px] font-medium px-2.5 py-1 rounded-md border flex-shrink-0"
                    style={{ background: rs.bg, borderColor: rs.border, color: rs.color }}
                  >
                    {m.role.charAt(0).toUpperCase() + m.role.slice(1)}
                  </span>

                  {/* Date */}
                  <span className="text-xs text-muted-foreground flex-shrink-0 w-16 text-right">
                    {fmtDate(m.created_at)}
                  </span>

                  {/* More menu */}
                  <div className="relative flex-shrink-0">
                    <button
                      id={`${uid}-${m.user_id}`}
                      onClick={() => setOpenMenu(openMenu === m.user_id ? null : m.user_id)}
                      className="p-1.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted transition-all"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                    {openMenu === m.user_id && (
                      <div
                        className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-border shadow-lg z-20 overflow-hidden"
                        style={{ background: "#0d1829" }}
                      >
                        {!isSelf && (
                          <button
                            onClick={() => handleRemove(m)}
                            disabled={removing === m.user_id}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            {removing === m.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            Remove
                          </button>
                        )}
                        <button
                          onClick={() => setOpenMenu(null)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                          Close
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Pending invites */}
            {pending.map((inv) => (
              <div key={inv.email} className="flex items-center gap-4 px-6 py-3.5 hover:bg-muted/40 transition-colors group">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-mono flex-shrink-0"
                  style={{ background: "rgba(90,114,148,0.15)", color: "#5a7294", border: "1px dashed rgba(90,114,148,0.4)" }}
                >
                  ?
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{inv.email}</p>
                  <p className="text-xs" style={{ color: "#5a7294" }}>Invite pending</p>
                </div>
                <span className="text-[11px] font-medium px-2.5 py-1 rounded-md border flex-shrink-0"
                  style={{ background: "rgba(90,114,148,0.1)", borderColor: "rgba(90,114,148,0.25)", color: "#8899b0" }}>
                  {inv.role.charAt(0).toUpperCase() + inv.role.slice(1)}
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0 w-16 text-right">
                  {fmtDate(inv.created_at)}
                </span>
                <button
                  onClick={() => handleCancelInvite(inv.email)}
                  className="p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TeamsPage() {
  const [teams,          setTeams]          = useState<Team[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState("");
  const [selectedId,     setSelectedId]     = useState<string | null>(null);
  const [currentUserId,  setCurrentUserId]  = useState<string | null>(null);
  const [showCreate,     setShowCreate]     = useState(false);
  const [newTeamName,    setNewTeamName]    = useState("");
  const [creating,       setCreating]       = useState(false);
  const [createErr,      setCreateErr]      = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/teams");
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? "Failed to load teams");
        return;
      }
      const data: Team[] = await res.json();
      setTeams(data);
      if (!selectedId && data.length > 0) setSelectedId(data[0].team_id);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    load();
    // Get current user id from project context (via profiles or supabase)
    fetch("/api/projects").then(async (r) => {
      // We don't directly have a /api/me, so we get it from members route later
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    setCreating(true);
    setCreateErr("");
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_name: newTeamName.trim() }),
      });
      const body = await res.json();
      if (!res.ok) { setCreateErr((body as { error?: string }).error ?? "Failed to create team"); return; }
      const newTeam = body as Team;
      setTeams((prev) => [...prev, newTeam]);
      setSelectedId(newTeam.team_id);
      setNewTeamName("");
      setShowCreate(false);
    } catch {
      setCreateErr("Network error");
    } finally {
      setCreating(false);
    }
  }

  const selectedTeam = teams.find((t) => t.team_id === selectedId) ?? null;

  return (
    <div className="flex gap-5 h-[calc(100vh-112px)]">

      {/* ── Left panel ── */}
      <div className="w-[340px] flex-shrink-0 flex flex-col gap-3">
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground px-1">
          Your Teams
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="rounded-xl p-4 text-sm" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
            {error}
          </div>
        ) : (
          <div className="space-y-2 flex-1 overflow-y-auto">
            {teams.map((team) => {
              const isActive = team.team_id === selectedId;
              const letter   = team.team_name.charAt(0).toUpperCase();
              return (
                <button
                  key={team.team_id}
                  type="button"
                  onClick={() => setSelectedId(team.team_id)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border text-left transition-all"
                  style={{
                    background:   isActive ? "rgba(0,201,255,0.06)" : "#0d1829",
                    borderColor:  isActive ? "rgba(0,201,255,0.25)" : "rgba(255,255,255,0.07)",
                    boxShadow:    isActive ? "0 0 0 1px rgba(0,201,255,0.1)" : "none",
                  }}
                >
                  {/* Letter avatar */}
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ background: avatarGradient(team.team_id) }}
                  >
                    {letter}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate" style={{ fontFamily: "Outfit, sans-serif" }}>
                      {team.team_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {team.project_count} project{team.project_count !== 1 ? "s" : ""}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Create team */}
        {showCreate ? (
          <form onSubmit={handleCreate} className="p-4 rounded-xl border border-border bg-card space-y-3">
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">New team</p>
            <input
              autoFocus
              type="text"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="Team name"
              className="w-full px-3 py-2 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {createErr && <p className="text-xs" style={{ color: "#ef4444" }}>{createErr}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating || !newTeamName.trim()}
                className="flex-1 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
              >
                {creating ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setNewTeamName(""); setCreateErr(""); }}
                className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors border border-border"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-3 rounded-xl border border-dashed text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
            style={{ borderColor: "rgba(255,255,255,0.12)", color: "#5a7294" }}
          >
            <Plus className="w-4 h-4" />
            Create team
          </button>
        )}
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 min-w-0">
        {selectedTeam ? (
          <TeamDetail
            team={selectedTeam}
            currentUserId={currentUserId}
            onMemberChange={() => {
              setTeams((prev) =>
                prev.map((t) =>
                  t.team_id === selectedTeam.team_id
                    ? { ...t, member_count: t.member_count }
                    : t
                )
              );
            }}
          />
        ) : (
          <div className="bg-card border border-border rounded-2xl h-full flex items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {teams.length === 0
                ? "Create your first team to get started."
                : "Select a team to view its members."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
