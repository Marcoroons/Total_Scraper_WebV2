-- ============================================================================
-- Pending invites — run ONCE in the Supabase SQL editor (after
-- team_collaboration.sql). Lets you invite an email that has no account yet;
-- the invite auto-converts to a project_members row the first time that user
-- loads their projects after signing up.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.project_invites (
    id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES public.projects(project_id) ON DELETE CASCADE,
    email      text NOT NULL,
    invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, email)
);

CREATE INDEX IF NOT EXISTS idx_project_invites_email ON public.project_invites(email);

-- project_invites holds emails (PII). Protect with RLS the same way profiles is:
-- only *authenticated* callers may touch it (blocks public anon-key reads).
-- App-layer route checks still enforce that only project members manage invites.
ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read invites"   ON public.project_invites;
DROP POLICY IF EXISTS "authenticated can insert invites" ON public.project_invites;
DROP POLICY IF EXISTS "authenticated can delete invites" ON public.project_invites;

CREATE POLICY "authenticated can read invites"
    ON public.project_invites FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated can insert invites"
    ON public.project_invites FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated can delete invites"
    ON public.project_invites FOR DELETE TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
