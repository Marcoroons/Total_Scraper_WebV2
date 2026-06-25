-- ============================================================================
-- Teams fix — run ONCE in the Supabase SQL editor. Resolves two errors:
--   • "infinite recursion detected in policy for relation team_members"
--   • lets you invite emails that don't have an account yet
--
--   1. Turns RLS OFF on the team tables. They had a self-referential policy
--      (a team_members policy that itself queried team_members → infinite
--      recursion). Access is enforced in the API routes, matching the existing
--      projects / project_members / team_members design (see team_collaboration.sql).
--   2. Adds team_invites: invite by email even before the person signs up. The
--      invite auto-converts to a team_members row the first time that user signs
--      in (handled in /api/teams GET) — no accept/confirmation step.
-- ============================================================================

-- 1. Remove the recursive-policy footgun on the team tables.
ALTER TABLE public.team_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams        DISABLE ROW LEVEL SECURITY;

-- 2. Pending team invites (email may belong to a not-yet-registered user).
--    No FKs on team_id/invited_by on purpose — keeps this migration robust to
--    schema variants; integrity is enforced in the API.
CREATE TABLE IF NOT EXISTS public.team_invites (
    id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    team_id    uuid NOT NULL,
    email      text NOT NULL,
    role       text NOT NULL DEFAULT 'analyst',
    invited_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (team_id, email)
);

CREATE INDEX IF NOT EXISTS idx_team_invites_email ON public.team_invites(email);

-- team_invites holds emails (PII). Match the project_invites posture: only
-- authenticated callers may touch it; the API enforces team-membership checks.
ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read team invites"   ON public.team_invites;
DROP POLICY IF EXISTS "authenticated can insert team invites" ON public.team_invites;
DROP POLICY IF EXISTS "authenticated can delete team invites" ON public.team_invites;

CREATE POLICY "authenticated can read team invites"
    ON public.team_invites FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated can insert team invites"
    ON public.team_invites FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated can delete team invites"
    ON public.team_invites FOR DELETE TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
