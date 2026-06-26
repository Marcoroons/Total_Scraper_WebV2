"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Crown, Trash2, UserPlus, X } from "lucide-react";
import { CatSpinner } from "@/components/CatSpinner";

interface Member {
  user_id: string;
  email: string;
  role: string;
  created_at: string;
}

interface PendingInvite {
  email: string;
  created_at: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function TeamMembersList({ projectId }: { projectId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [addNotice, setAddNotice] = useState("");

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [cancelingEmail, setCancelingEmail] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/members`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to load members.");
        return;
      }
      const data = (await res.json()) as {
        members: Member[];
        pending?: PendingInvite[];
        current_user_id: string;
      };
      setMembers(data.members);
      setPending(data.pending ?? []);
      setCurrentUserId(data.current_user_id);
    } catch {
      setError("Network error loading members.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAdding(true);
    setAddError("");
    setAddNotice("");
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        pending?: boolean;
        email?: string;
      };
      if (!res.ok) {
        setAddError(body.error ?? "Failed to add member.");
        return;
      }
      if (body.pending) {
        setAddNotice(`Invitation saved — ${body.email} will join automatically when they sign up.`);
      }
      setNewEmail("");
      setShowAdd(false);
      await load();
    } catch {
      setAddError("Network error — could not add member.");
    } finally {
      setAdding(false);
    }
  }

  async function handleCancelInvite(email: string) {
    if (!confirm(`Cancel the pending invite for ${email}?`)) return;
    setCancelingEmail(email);
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Failed to cancel invite.");
        return;
      }
      await load();
    } catch {
      alert("Network error — could not cancel invite.");
    } finally {
      setCancelingEmail(null);
    }
  }

  async function handleRemove(member: Member) {
    if (!confirm(`Remove ${member.email} from this project?`)) return;
    setRemovingId(member.user_id);
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: member.user_id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Failed to remove member.");
        return;
      }
      await load();
    } catch {
      alert("Network error — could not remove member.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {members.length} member{members.length !== 1 ? "s" : ""}
        </p>
        {!showAdd && (
          <button
            type="button"
            onClick={() => { setShowAdd(true); setAddError(""); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Add Member
          </button>
        )}
      </div>

      {/* Add member form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="bg-muted border border-border rounded-xl p-3 space-y-2">
          <label className="block text-xs font-semibold text-muted-foreground">Invite by email</label>
          <div className="flex gap-2">
            <input
              autoFocus
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="teammate@example.com"
              className="flex-1 px-3 py-1.5 text-sm bg-input border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={adding || !newEmail.trim()}
              className="px-4 py-1.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {adding ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => { setShowAdd(false); setNewEmail(""); setAddError(""); }}
              className="p-1.5 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {addError && <p className="text-xs text-destructive">{addError}</p>}
          <p className="text-xs text-muted-foreground">
            If they already have an account they&apos;re added immediately. Otherwise the invite is saved and activates when they sign up.
          </p>
        </form>
      )}

      {/* Notice */}
      {addNotice && (
        <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 text-xs text-primary">
          {addNotice}
        </div>
      )}

      {/* Members list */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <CatSpinner size={20} />
        </div>
      ) : error ? (
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 text-sm text-destructive">{error}</div>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden">
          {members.map((m) => {
            const isOwner = m.role === "owner";
            const isSelf  = m.user_id === currentUserId;
            const canRemove = !isOwner && !isSelf;
            return (
              <li key={m.user_id} className="flex items-center gap-3 px-4 py-3 bg-card">
                <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary uppercase flex-shrink-0">
                  {m.email.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                    {m.email}
                    {isOwner && (
                      <span title="Owner" className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-primary bg-primary/15 px-1.5 py-0.5 rounded">
                        <Crown className="w-3 h-3" /> Owner
                      </span>
                    )}
                    {isSelf && <span className="text-[10px] text-muted-foreground">(you)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">Joined {formatDate(m.created_at)}</p>
                </div>
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => handleRemove(m)}
                    disabled={removingId === m.user_id}
                    title="Remove member"
                    className="p-1.5 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-40"
                  >
                    {removingId === m.user_id ? (
                      <CatSpinner size={16} />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Pending invites */}
      {!loading && !error && pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pending invites
          </p>
          <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden">
            {pending.map((inv) => (
              <li key={inv.email} className="flex items-center gap-3 px-4 py-3 bg-card">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                    {inv.email}
                    <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      Pending
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">Invited {formatDate(inv.created_at)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleCancelInvite(inv.email)}
                  disabled={cancelingEmail === inv.email}
                  title="Cancel invite"
                  className="p-1.5 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-40"
                >
                  {cancelingEmail === inv.email ? (
                    <CatSpinner size={16} />
                  ) : (
                    <X className="w-4 h-4" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
