-- ============================================================================
-- Team / Collaboration support — run ONCE in the Supabase SQL editor.
--
-- Adds:
--   1. public.profiles      — mirrors auth.users(id, email) so the web app
--                             (anon key only) can map email <-> user_id without
--                             a service-role key. Populated by a trigger on
--                             new signups + a one-time backfill.
--   2. public.project_members — per-project membership (flat access: any member
--                             sees & manages the project). The owner gets a
--                             role='owner' row that cannot be removed.
-- ============================================================================

-- ── 1. profiles ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
    id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email text UNIQUE NOT NULL
);

-- Backfill existing users
INSERT INTO public.profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Keep profiles in sync on new signups
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- profiles contains PII (emails) — protect with RLS.
-- Any *authenticated* user may read profiles (needed for invite-by-email and
-- for displaying co-members' emails). Anonymous (logged-out) callers cannot.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read profiles" ON public.profiles;
CREATE POLICY "authenticated can read profiles"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);

-- ── 2. project_members ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_members (
    id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES public.projects(project_id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role       text NOT NULL DEFAULT 'member',   -- 'owner' | 'member'
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user    ON public.project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON public.project_members(project_id);

-- Backfill: give every existing personal project's owner an 'owner' row.
-- (Team projects continue to be shared via the existing team_members model.)
INSERT INTO public.project_members (project_id, user_id, role)
SELECT project_id, user_id, 'owner'
FROM public.projects
WHERE user_id IS NOT NULL
ON CONFLICT (project_id, user_id) DO NOTHING;

-- NOTE: RLS is intentionally LEFT OFF on project_members, matching the existing
-- projects / team_members tables (access is enforced in the API routes, which
-- verify the caller is a member before listing or mutating). Enabling RLS here
-- would require a SECURITY DEFINER helper to avoid the self-referential policy
-- recursion footgun — deferred as a future hardening step.

NOTIFY pgrst, 'reload schema';
