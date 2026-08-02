-- Quarry Ledger — initial sync schema.
--
-- One project, one team, a handful of people. The design follows three rules
-- that come from the app, not from Postgres:
--
--   1. The ledger row is the single source of truth. Nothing derived is stored
--      here either — no amounts, no totals. The server is a synchronisation
--      point, not a second calculation engine.
--   2. Conflicts resolve by last-write-wins on the DEVICE clock (`updated_at`,
--      ms since epoch), while the pull cursor uses the SERVER clock
--      (`synced_at`). Skew can pick an unexpected winner; it can never lose a
--      record, because the cursor never depends on a device's opinion of time.
--   3. Deletes are tombstones. A dropped row would be resurrected by any device
--      that still had it.
--
-- Row-level security is the ONLY access boundary. The anon key ships in the
-- client and is public by design; all authority comes from the signed-in user's
-- JWT. Because the project has "automatically expose new tables" disabled,
-- every table below also needs its explicit grant — a table with no grant fails
-- at runtime with a confusing "permission denied" despite plainly existing.

-- ---------------------------------------------------------------------------
-- Team and membership
-- ---------------------------------------------------------------------------

create table if not exists public.teams (
  id   uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- The allow-list. A signed-in user with no row here sees nothing and can write
-- nothing, which is what makes membership admin-controlled rather than open.
create table if not exists public.members (
  user_id uuid not null references auth.users (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  email   text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, team_id)
);

-- The single team this deployment uses.
insert into public.teams (id, name)
select '00000000-0000-4000-8000-000000000001', 'Quarry Ledger'
where not exists (select 1 from public.teams);

/**
 * The caller's team ids.
 *
 * SECURITY DEFINER on purpose: every policy below calls this, and `members`
 * itself is RLS-protected. A policy on `members` that queried `members`
 * directly would recurse forever — this function breaks that cycle.
 */
create or replace function public.my_team_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select team_id from public.members where user_id = auth.uid();
$$;

revoke all on function public.my_team_ids() from public;
grant execute on function public.my_team_ids() to authenticated;

/**
 * Link an invited user to the team by email.
 *
 * Membership is deliberately manual — there is no in-app admin screen and no
 * service-role key anywhere in this project. Invite the person in the dashboard
 * first (Authentication -> Users -> Send invitation), then:
 *
 *     select public.add_member('someone@example.com');
 */
create or replace function public.add_member(member_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid;
  team uuid;
begin
  select id into uid from auth.users where lower(email) = lower(member_email);
  if uid is null then
    raise exception 'No such user: % — invite them in the dashboard first', member_email;
  end if;
  select id into team from public.teams order by created_at limit 1;

  insert into public.members (user_id, team_id, email)
  values (uid, team, member_email)
  on conflict (user_id, team_id) do nothing;
end;
$$;

revoke all on function public.add_member(text) from public;

-- Everyone already invited joins the team. Safe because self-signup is
-- disabled, so `auth.users` contains exactly the people who were invited.
insert into public.members (user_id, team_id, email)
select u.id, (select id from public.teams order by created_at limit 1), u.email
from auth.users u
on conflict (user_id, team_id) do nothing;

alter table public.teams   enable row level security;
alter table public.members enable row level security;

drop policy if exists teams_read on public.teams;
create policy teams_read on public.teams
  for select to authenticated
  using (id in (select t from public.my_team_ids() t));

-- Read-only: membership is changed from the SQL editor, never by the app.
drop policy if exists members_read on public.members;
create policy members_read on public.members
  for select to authenticated
  using (team_id in (select t from public.my_team_ids() t));

grant select on public.teams   to authenticated;
grant select on public.members to authenticated;

-- ---------------------------------------------------------------------------
-- Server clock
-- ---------------------------------------------------------------------------

/**
 * Stamp `synced_at` from the SERVER clock on every write.
 *
 * This is what the pull cursor advances on. It must never come from the client:
 * a device with a slow clock could otherwise write a row "in the past" and have
 * every other device skip straight over it.
 */
create or replace function public.touch_synced_at()
returns trigger
language plpgsql
as $$
begin
  new.synced_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ledger rows (daily book)
-- ---------------------------------------------------------------------------

create table if not exists public.ledger_rows (
  team_id    uuid not null references public.teams (id) on delete cascade,
  -- The app's own row id: immutable, minted on the device, and the merge key
  -- everywhere. Never regenerated, so it is safe as half the primary key.
  id         text not null,
  -- Which book. Mirrors the `acc:<id>:<collection>` key scheme; the default
  -- book is 'default'.
  account_id text not null,

  -- Stored exactly as the app holds it. `date` is text, not `date`: the app
  -- treats it as an opaque ISO string and there is no server-side date query to
  -- justify a conversion that could ever round-trip differently.
  date        text not null,
  item        text not null default 'Rock',
  crusher     text not null default '',
  -- Nullable on purpose: one real row belongs to neither pass split, and the
  -- reports depend on that staying null rather than being forced to a value.
  pass_type   text,
  -- Unconstrained numeric: some quantities carry 3 decimals, and a narrower
  -- type would silently truncate rather than fail loudly.
  qty         numeric not null default 0,
  quary_rate  numeric not null default 0,
  crusher_rate numeric not null default 0,
  rent_rate   numeric not null default 0,
  comm_rate   numeric not null default 0,
  vehicle     text not null default '',

  -- A staged row that has not yet been synced to the book. One column rather
  -- than a second table, so "Save to ledger" propagates as an ordinary field
  -- update instead of a delete plus an insert.
  draft      boolean not null default false,
  deleted    boolean not null default false,
  updated_at bigint  not null default 0,
  synced_at  timestamptz not null default now(),

  primary key (team_id, id),
  constraint ledger_rows_pass_type_check
    check (pass_type is null or pass_type in ('Pass', 'WO Pass'))
);

-- The pull query: "everything in my team since my cursor".
create index if not exists ledger_rows_pull_idx
  on public.ledger_rows (team_id, synced_at);

drop trigger if exists ledger_rows_touch on public.ledger_rows;
create trigger ledger_rows_touch
  before insert or update on public.ledger_rows
  for each row execute function public.touch_synced_at();

-- ---------------------------------------------------------------------------
-- Party rows
-- ---------------------------------------------------------------------------

create table if not exists public.party_rows (
  team_id    uuid not null references public.teams (id) on delete cascade,
  id         text not null,
  account_id text not null,

  date       text not null,
  party      text not null default '',
  item       text not null default 'Rock',
  vehicle    text not null default '',
  -- Per-row snapshot, not a lookup: the same vehicle is attributed to different
  -- owners on different parties' loads in the real data.
  owner      text not null default '',
  qty        numeric not null default 0,
  with_rent  boolean not null default false,
  quary_rate numeric not null default 0,
  bill_rate  numeric not null default 0,
  rent_rate  numeric not null default 0,
  -- The resolved split, snapshotted with the row: [{"name": "...", "perTon": n}].
  profit_shares jsonb not null default '[]'::jsonb,

  draft      boolean not null default false,
  deleted    boolean not null default false,
  updated_at bigint  not null default 0,
  synced_at  timestamptz not null default now(),

  primary key (team_id, id)
);

create index if not exists party_rows_pull_idx
  on public.party_rows (team_id, synced_at);

drop trigger if exists party_rows_touch on public.party_rows;
create trigger party_rows_touch
  before insert or update on public.party_rows
  for each row execute function public.touch_synced_at();

-- ---------------------------------------------------------------------------
-- Collections — reference data and the book registry
-- ---------------------------------------------------------------------------

-- Whole-document last-write-wins. These are edited rarely and by one person, so
-- per-document resolution is right; the client still applies its own key-based
-- merge (mergeRateChart / mergeVehicles / mergePartyRates) on pull rather than
-- clobbering what it holds.
create table if not exists public.collections (
  team_id    uuid not null references public.teams (id) on delete cascade,
  -- The app's collection key, e.g. 'rate-chart' or 'acc:<id>:party-rates'.
  key        text not null,
  version    integer not null default 1,
  data       jsonb   not null,
  updated_at bigint  not null default 0,
  synced_at  timestamptz not null default now(),
  primary key (team_id, key)
);

create index if not exists collections_pull_idx
  on public.collections (team_id, synced_at);

drop trigger if exists collections_touch on public.collections;
create trigger collections_touch
  before insert or update on public.collections
  for each row execute function public.touch_synced_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.ledger_rows enable row level security;
alter table public.party_rows  enable row level security;
alter table public.collections enable row level security;

drop policy if exists ledger_rows_rw on public.ledger_rows;
create policy ledger_rows_rw on public.ledger_rows
  for all to authenticated
  using (team_id in (select t from public.my_team_ids() t))
  with check (team_id in (select t from public.my_team_ids() t));

drop policy if exists party_rows_rw on public.party_rows;
create policy party_rows_rw on public.party_rows
  for all to authenticated
  using (team_id in (select t from public.my_team_ids() t))
  with check (team_id in (select t from public.my_team_ids() t));

drop policy if exists collections_rw on public.collections;
create policy collections_rw on public.collections
  for all to authenticated
  using (team_id in (select t from public.my_team_ids() t))
  with check (team_id in (select t from public.my_team_ids() t));

-- No delete grant anywhere: rows are tombstoned, never removed.
grant select, insert, update on public.ledger_rows to authenticated;
grant select, insert, update on public.party_rows  to authenticated;
grant select, insert, update on public.collections to authenticated;

-- ---------------------------------------------------------------------------
-- Conditional upsert
-- ---------------------------------------------------------------------------
--
-- PostgREST's own upsert cannot express "only if newer", and without that a
-- device pushing stale rows would overwrite a newer server copy — losing an
-- edit made elsewhere. Server-side last-write-wins belongs here, mirroring
-- `incomingWins` in src/domain/merge.ts.
--
-- `team_id` is derived from the caller and any value in the payload is ignored,
-- so a client cannot write into another team even by mistake. SECURITY INVOKER
-- (the default) so RLS still applies on top.

create or replace function public.push_ledger_rows(payload jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  team     uuid;
  affected integer;
begin
  select t into team from public.my_team_ids() t limit 1;
  if team is null then
    raise exception 'not a team member';
  end if;

  insert into public.ledger_rows as t (
    team_id, id, account_id, date, item, crusher, pass_type, qty,
    quary_rate, crusher_rate, rent_rate, comm_rate, vehicle,
    draft, deleted, updated_at
  )
  select
    team,
    r ->> 'id',
    coalesce(r ->> 'account_id', 'default'),
    coalesce(r ->> 'date', ''),
    coalesce(r ->> 'item', 'Rock'),
    coalesce(r ->> 'crusher', ''),
    nullif(r ->> 'pass_type', ''),
    coalesce((r ->> 'qty')::numeric, 0),
    coalesce((r ->> 'quary_rate')::numeric, 0),
    coalesce((r ->> 'crusher_rate')::numeric, 0),
    coalesce((r ->> 'rent_rate')::numeric, 0),
    coalesce((r ->> 'comm_rate')::numeric, 0),
    coalesce(r ->> 'vehicle', ''),
    coalesce((r ->> 'draft')::boolean, false),
    coalesce((r ->> 'deleted')::boolean, false),
    coalesce((r ->> 'updated_at')::bigint, 0)
  from jsonb_array_elements(payload) as r
  where coalesce(r ->> 'id', '') <> ''
  on conflict (team_id, id) do update set
    account_id   = excluded.account_id,
    date         = excluded.date,
    item         = excluded.item,
    crusher      = excluded.crusher,
    pass_type    = excluded.pass_type,
    qty          = excluded.qty,
    quary_rate   = excluded.quary_rate,
    crusher_rate = excluded.crusher_rate,
    rent_rate    = excluded.rent_rate,
    comm_rate    = excluded.comm_rate,
    vehicle      = excluded.vehicle,
    draft        = excluded.draft,
    deleted      = excluded.deleted,
    updated_at   = excluded.updated_at
  where excluded.updated_at > t.updated_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.push_party_rows(payload jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  team     uuid;
  affected integer;
begin
  select t into team from public.my_team_ids() t limit 1;
  if team is null then
    raise exception 'not a team member';
  end if;

  insert into public.party_rows as t (
    team_id, id, account_id, date, party, item, vehicle, owner, qty,
    with_rent, quary_rate, bill_rate, rent_rate, profit_shares,
    draft, deleted, updated_at
  )
  select
    team,
    r ->> 'id',
    coalesce(r ->> 'account_id', ''),
    coalesce(r ->> 'date', ''),
    coalesce(r ->> 'party', ''),
    coalesce(r ->> 'item', 'Rock'),
    coalesce(r ->> 'vehicle', ''),
    coalesce(r ->> 'owner', ''),
    coalesce((r ->> 'qty')::numeric, 0),
    coalesce((r ->> 'with_rent')::boolean, false),
    coalesce((r ->> 'quary_rate')::numeric, 0),
    coalesce((r ->> 'bill_rate')::numeric, 0),
    coalesce((r ->> 'rent_rate')::numeric, 0),
    coalesce(r -> 'profit_shares', '[]'::jsonb),
    coalesce((r ->> 'draft')::boolean, false),
    coalesce((r ->> 'deleted')::boolean, false),
    coalesce((r ->> 'updated_at')::bigint, 0)
  from jsonb_array_elements(payload) as r
  where coalesce(r ->> 'id', '') <> ''
  on conflict (team_id, id) do update set
    account_id    = excluded.account_id,
    date          = excluded.date,
    party         = excluded.party,
    item          = excluded.item,
    vehicle       = excluded.vehicle,
    owner         = excluded.owner,
    qty           = excluded.qty,
    with_rent     = excluded.with_rent,
    quary_rate    = excluded.quary_rate,
    bill_rate     = excluded.bill_rate,
    rent_rate     = excluded.rent_rate,
    profit_shares = excluded.profit_shares,
    draft         = excluded.draft,
    deleted       = excluded.deleted,
    updated_at    = excluded.updated_at
  where excluded.updated_at > t.updated_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.push_collections(payload jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  team     uuid;
  affected integer;
begin
  select t into team from public.my_team_ids() t limit 1;
  if team is null then
    raise exception 'not a team member';
  end if;

  insert into public.collections as t (team_id, key, version, data, updated_at)
  select
    team,
    r ->> 'key',
    coalesce((r ->> 'version')::integer, 1),
    coalesce(r -> 'data', '{}'::jsonb),
    coalesce((r ->> 'updated_at')::bigint, 0)
  from jsonb_array_elements(payload) as r
  where coalesce(r ->> 'key', '') <> ''
  on conflict (team_id, key) do update set
    version    = excluded.version,
    data       = excluded.data,
    updated_at = excluded.updated_at
  where excluded.updated_at > t.updated_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.push_ledger_rows(jsonb) from public;
revoke all on function public.push_party_rows(jsonb)  from public;
revoke all on function public.push_collections(jsonb) from public;
grant execute on function public.push_ledger_rows(jsonb) to authenticated;
grant execute on function public.push_party_rows(jsonb)  to authenticated;
grant execute on function public.push_collections(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Keepalive
-- ---------------------------------------------------------------------------
--
-- Free-tier projects pause after about a week of inactivity, and a paused
-- project fails every sync until someone un-pauses it by hand. A scheduled
-- GitHub Actions workflow reads this table weekly to keep the project awake.
--
-- It exists because that ping carries only the anon key, with no user session.
-- Every other table is closed to `anon`, so the request would be rejected
-- before doing any real database work — and a rejected request is a weak claim
-- to "activity". This gives it something legitimate and harmless to read.
--
-- It holds no business data and has no write path from the client.

create table if not exists public.health (
  id         integer primary key default 1,
  checked_at timestamptz not null default now(),
  constraint health_single_row check (id = 1)
);

insert into public.health (id) values (1) on conflict (id) do nothing;

alter table public.health enable row level security;

drop policy if exists health_read on public.health;
create policy health_read on public.health
  for select to anon, authenticated
  using (true);

grant select on public.health to anon, authenticated;
