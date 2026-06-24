# Security notes — Total Scraper Web

Status of each risk you raised, what's handled in code, and the config you must
set in Supabase/Vercel before going public.

---

## TL;DR — do these before public launch
1. **Enable Row Level Security (RLS)** on every Supabase table (see below). This is
   the single most important control — without it the *public* anon key can read
   your whole database directly.
2. **Set session expiry** (Supabase → Auth → Sessions): time-box + inactivity timeout.
3. **Turn on CAPTCHA + confirm auth rate limits** (Supabase → Auth) to blunt
   password-guessing and reset abuse.
4. **Enable leaked-password protection** (Supabase → Auth → Passwords).
5. Confirm all real secrets live in **Vercel/Railway env vars**, never the repo.

---

## Your questions, answered

### Are we hashing passwords?
**Yes — and we never see them.** Passwords are passed straight to Supabase Auth
(GoTrue), which stores only a **bcrypt** hash. The app never stores or logs plaintext.

### Wrong password many times with no lockout
Supabase Auth applies **built-in rate limiting** to `signInWithPassword` (per IP).
There's no hard per-account "lockout," but you can:
- Tighten limits: Supabase → Auth → Rate Limits.
- **Enable CAPTCHA** (Supabase → Auth → Bot & Abuse Protection — hCaptcha/Turnstile);
  the client SDK then requires a token, which kills automated guessing.

### Same-email sign-ups (duplicates)
Handled: signup lowercases the email, pre-checks the `profiles` mirror, and
`auth.admin.createUser` enforces uniqueness as the backstop. Login also lowercases.
Confirm Supabase isn't set to allow the same email across multiple providers.

### Password-reset abuse
`resetPasswordForEmail` is **rate-limited by Supabase** (email-send limits, per IP).
Add CAPTCHA (above) for extra protection. The reset link is single-use and expires.

### Sessions that never expire
Supabase access tokens (JWT) **expire by default (~1 hour)**; refresh tokens rotate.
Middleware revalidates the session on every request via `getUser()`. To cap total
session length, set **Supabase → Auth → Sessions**: a *time-box* (e.g. 7 days) and
an *inactivity timeout* (e.g. 1 day). Currently these are likely unset → refresh can
continue indefinitely. Set them.

### If someone pastes another user's URL, can they see that user's data?
**No.** URLs carry no data; every page requires auth (middleware redirects to
`/login`), and all data is fetched through API routes scoped to the caller's session
with explicit ownership checks. After enabling RLS it's also enforced at the DB layer.
(The one gap — `/api/nlp-config` not checking project membership — is fixed in this change.)

### API keys handled safely?
**Yes (audited).** Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
reach the browser, and both are public by design. `SUPABASE_SERVICE_ROLE_KEY`,
`INVITE_CODE`, `APIFY_TOKEN`, and the worker's `SUPABASE_KEY` (service role) exist only
as server-side env vars (Vercel API routes / Railway). No secrets are hardcoded.

### Rate limiting / input validation / sanitization
- Auth endpoints: rate-limited by Supabase.
- App API routes: every route checks auth + ownership; inputs are validated
  (email format, required fields, length caps, enum whitelists for status/role/frequency).
- We never build SQL strings — Supabase's client parameterises queries, so SQL
  injection isn't a vector. React escapes rendered output (no `dangerouslySetInnerHTML`),
  so stored values can't inject HTML/JS.

---

## Row Level Security (RLS) — the big one

**Why it matters:** the anon key is embedded in the frontend (it must be). With RLS
**off**, anyone can copy it from the page and call
`https://<project>.supabase.co/rest/v1/scrape_jobs?select=*` to read/write the whole
table directly — bypassing every check in our API routes. RLS is what stops that.

**Enable it NOW, before public — not "after more changes."** It's a coordinated change
because the app must keep working once it's on:
- The **worker** and **export-service** use the **service-role key**, which *bypasses*
  RLS — so they keep working untouched.
- The **Next.js API routes** run as the logged-in user, so each table needs policies
  that let users reach their own rows.
- The **realtime** job feed (browser) needs a `SELECT` policy on `scrape_jobs`.

### Recommended policies (run in Supabase SQL editor, then TEST each feature)

```sql
-- Helper: is the current user allowed to touch this project?
create or replace function public.can_access_project(pid uuid)
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.projects p where p.project_id = pid and p.user_id = auth.uid())
      or exists (select 1 from public.project_members m where m.project_id = pid and m.user_id = auth.uid())
      or exists (select 1 from public.projects p join public.team_members tm on tm.team_id = p.team_id
                 where p.project_id = pid and tm.user_id = auth.uid());
$$;

-- profiles: read your own row (member emails are fetched server-side via service role)
alter table public.profiles enable row level security;
create policy profiles_self_rw on public.profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

-- projects
alter table public.projects enable row level security;
create policy projects_read on public.projects for select using (public.can_access_project(project_id));
create policy projects_insert on public.projects for insert with check (user_id = auth.uid());
create policy projects_modify on public.projects for update using (user_id = auth.uid());
create policy projects_delete on public.projects for delete using (user_id = auth.uid());

-- scrape_jobs (also enables the realtime feed for members)
alter table public.scrape_jobs enable row level security;
create policy jobs_all on public.scrape_jobs for all
  using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));

-- nlp_configs, scheduled_reports, kol_snapshots: same project scoping
alter table public.nlp_configs enable row level security;
create policy nlp_all on public.nlp_configs for all
  using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));

alter table public.scheduled_reports enable row level security;
create policy sched_all on public.scheduled_reports for all
  using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));

alter table public.kol_snapshots enable row level security;
create policy snap_read on public.kol_snapshots for select using (public.can_access_project(project_id));

-- teams / members / invites
alter table public.teams enable row level security;
create policy teams_read on public.teams for select using (
  exists (select 1 from public.team_members m where m.team_id = teams.team_id and m.user_id = auth.uid()));
create policy teams_owner on public.teams for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter table public.team_members enable row level security;
create policy tm_read on public.team_members for select using (
  exists (select 1 from public.team_members m2 where m2.team_id = team_members.team_id and m2.user_id = auth.uid()));

alter table public.project_members enable row level security;
create policy pm_read on public.project_members for select using (public.can_access_project(project_id));

-- Global scraped-data tables: written ONLY by the worker (service role).
-- Authenticated users may read; nobody can write via the public key.
do $$ declare t text;
begin
  foreach t in array array[
    'ig_influencer_profiles','tiktok_influencer_profiles',
    'ig_campaign_videos','tiktok_campaign_videos',
    'ig_comments','tiktok_comments','trend_discovery'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists read_auth on public.%I;', t);
    execute format('create policy read_auth on public.%I for select to authenticated using (true);', t);
  end loop;
end $$;
```

> ⚠️ Test after running: login, dashboard, queue (incl. realtime updates), exporter,
> teams, NLP settings. If the Teams page stops showing member emails, that read needs
> to move to the service role — tell me and I'll switch the members routes. I can also
> verify all policies with you once they're applied.

---

## Supabase dashboard checklist
- **Auth → Sessions**: set time-box (e.g. 7d) + inactivity timeout (e.g. 24h).
- **Auth → Rate Limits**: review sign-in / email-send limits.
- **Auth → Bot & Abuse Protection**: enable CAPTCHA (hCaptcha or Turnstile).
- **Auth → Passwords**: min length ≥ 8, enable "leaked password protection".
- **Auth → Providers**: ensure same-email-across-providers linking is off.
- **Database → Tables**: confirm RLS is **On** for every table (above).

## Handled in code
- Fixed `/api/nlp-config` IDOR — now verifies project access on GET + PUT.
- Length caps on project/team names; existing email-format + enum validation retained.
- **Account-enumeration:** signup no longer confirms whether an email is registered —
  duplicate emails return a generic message and the existence pre-check was removed
  (`createUser` still prevents duplicates authoritatively). Login and password reset
  were already generic. Caveat: instant sign-up auto-logs-in a *new* email, so
  existence can't be fully hidden — the invite-code gate remains the primary control.
