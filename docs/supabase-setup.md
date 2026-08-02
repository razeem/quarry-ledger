# Supabase setup

The sync backend for Quarry Ledger. One project, one team, three people.

Sync is **optional by construction**: if none of this exists, or the project is
paused, or a session has expired, the app behaves exactly as it did before sync —
entry, reports, printing, export and code/QR transfer all keep working offline.
Nothing here is on the critical path for using the app.

## Project

| | |
|---|---|
| Project | `Rock Ledger` (org: Razeem Softwares, Free tier) |
| Region | **South Asia (Mumbai) `ap-south-1`** — closest to the quarry |
| URL | `https://bhmpajxqtfemeotqmqga.supabase.co` |

Region cannot be changed after creation. It was recreated once for this reason:
the first attempt landed in Tokyo.

## Security settings

Set at project creation, under the Security section:

| Setting | Value | Why |
|---|---|---|
| Enable Data API | **on** | PostgREST is how the app talks to the database |
| Automatically expose new tables | **off** | A table is reachable only when a migration grants it. The migrations therefore carry explicit `grant` statements — forget one and you get a runtime "permission denied" on a table that visibly exists |
| Enable automatic RLS | **on** | Belt and braces. The migrations enable RLS explicitly, but this catches a table someone adds by hand |

## Authentication

- **Sign In / Providers → Email**: "Allow new users to sign up" is **off**. The app
  is invite-only; dashboard invitations bypass this setting, self-registration
  through the public API does not.
- **Sessions**: left at defaults. The session timebox settings are Pro-only, and
  the free-tier default (refresh tokens that do not expire) is what we want — a
  device that has been offline for weeks can still push when it reconnects.
- **Rate Limits**: emails raised to **30/hour**. The default is far lower and the
  built-in sender's cap is what blocked the third user invitation.
- **Multi-factor, passkeys, OAuth**: unused.

### Email delivery

Custom SMTP via a Gmail account with an app password:

| | |
|---|---|
| Host / port | `smtp.gmail.com` : `465` |
| Username / sender | `sakhav.razeem@gmail.com` |
| Password | a Google **app password** (16 chars, spaces stripped) |
| Sender name | Quarry Ledger |

A secondary Google account deliberately: the app password's blast radius is
limited to that account's sending, and it can be revoked without touching
anything else.

**This mailbox is the single point of failure for signing in.** If it is locked
out, nobody can receive a login code — sync stops, local work is unaffected.

Supabase's built-in sender is rate-limited to a couple of emails per hour and is
not usable in production. The symptom is a login code that silently never
arrives, so custom SMTP is not optional.

A domain-based sender (Resend, ~$10/yr for a domain) is nicer but needs DNS
access, which we do not have today. Swapping to one later is these settings only
— no code, no rebuild.

## Members

Membership is manual and deliberate. There is **no in-app admin screen and no
service-role key anywhere in this project** — which is what keeps the whole
deployment free of build secrets.

**To add someone:**

1. Authentication → Users → **Send invitation** (not "create user with password":
   the app only ever uses one-time codes, and a password is an unused credential
   path with no rotation story).
2. Insert their `members` row — see the migration for the exact statement.

**To remove someone:** delete their `members` row. RLS is evaluated per request,
so access stops immediately. Deleting the auth user as well is optional.

Do step 1 for everyone *before* running the migrations, so the migration can link
users into `members` by email.

## Applying the schema

`supabase/migrations/0001_init.sql` is the whole schema: tables, RLS policies,
the `members` allow-list, the conditional-upsert functions and the `health` table
the keepalive reads.

**Invite everyone before running it.** The migration links every existing
`auth.users` row into the team, which is safe precisely because self-signup is
disabled — the table contains exactly the people who were invited.

1. Dashboard → SQL Editor → New query.
2. Paste the whole file, run it. It is idempotent (`create ... if not exists`,
   `drop policy if exists`), so re-running after an edit is safe.
3. Check Authentication → Users against `select * from public.members;` — the row
   counts should match.

**Adding someone later:** invite them in the dashboard, then

```sql
select public.add_member('someone@example.com');
```

**Removing someone:** `delete from public.members where email = '…';` RLS is
evaluated per request, so access stops immediately. Deleting the auth user too is
optional belt-and-braces.

### What the schema does and does not do

- **No derived values are stored.** No amounts, no totals. The server is a
  synchronisation point, not a second calculation engine — the ledger row stays
  the single source of truth.
- **Deletes are tombstones** (`deleted boolean`), never row removal. There is no
  `delete` grant at all. A dropped row would be resurrected by any device that
  still had it.
- **Conflicts resolve on the device clock** (`updated_at`), but the pull cursor
  uses the server clock (`synced_at`, set by trigger). Skew can pick an
  unexpected winner; it can never lose a record.
- **`push_*` functions exist because PostgREST's upsert cannot say "only if
  newer".** Without that, a device pushing stale rows would overwrite a newer
  edit made elsewhere. They also derive `team_id` from the caller and ignore any
  in the payload.
- **Staged drafts are a `draft` column, not a second table**, so "Save to ledger"
  propagates as an ordinary field update rather than a delete plus an insert.

## Keys

- **anon / publishable** — ships in the built JS and is public by design. It
  identifies the project and grants nothing on its own; all authority comes from
  the signed-in user's JWT hitting RLS. Treated as a build *variable*, never a
  secret.
- **service_role** — bypasses RLS entirely. Not used by anything here. Do not put
  it in the repo, in CI, or in a chat message.

Do not click **"Disable legacy API keys"** — the anon key in use is a legacy JWT
key. Moving to the newer publishable key later is a config change, not a rebuild,
because the config is read at runtime.

## Wiring the app to it

`public/sync-config.json` is generated at build time by
`scripts/write-sync-config.mjs` from `SUPABASE_URL` and `SUPABASE_ANON_KEY`, and
is **always written — empty when they are unset**. Empty means sync is off and
the app behaves as it always did. A missing file would be indistinguishable from
a failed deploy; an empty one is an explicit statement.

- **Locally**: put both values in `.env` (gitignored). `npm start`, `npm run
  build` and `npm test` pick it up automatically.
- **CI / production**: set both as **repository variables** (not secrets) —
  Settings → Secrets and variables → Actions → Variables → New repository
  variable, named `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The deploy workflow's
  build step and the keepalive workflow both read them from `vars.`. Leave them
  unset and the deployed app simply runs with sync off.
- **e2e**: `playwright.config.ts` forces `SYNC_OFF=1`, so the suite always builds
  with no backend and can never reach the real project, whatever is in `.env`.

## Free tier

- **No automated backups.** The monthly `.xlsx` export is the restore point — see
  CLAUDE.md's "continuity workbook" section. This matters more now that deletes
  tombstone and replicate to every device by design.
- **Projects pause after ~a week of inactivity.** A scheduled GitHub Actions
  workflow pings a `health` table to keep it awake. Treat it as insurance, not a
  guarantee: Supabase has never formally blessed pinging, and GitHub disables
  scheduled workflows in a repo with no commits for 60 days.
- Pro tier removes pausing and adds daily backups. Not needed to build or prove
  any of this; the backups are the better argument of the two.
