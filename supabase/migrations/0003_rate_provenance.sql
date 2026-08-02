-- Rate provenance: which rate cells a human typed over, and what they held first.
--
-- A rate has always been a snapshot, so the stored numbers were already right.
-- What the row could not say was WHY its rate differs from the chart today —
-- a deliberate override, or a chart that has moved on since. Comparing against
-- the current chart cannot tell them apart, and inverts once a rate changes:
-- every untouched historical row starts reading as "edited" and every
-- typed-over row as "automatic".
--
-- So the row records it. `rates_from` holds `field:value` pairs — e.g.
-- `quaryRate:650;rentRate:250` — carrying the value each typed-over cell held
-- before the edit. NULL means every rate matched the chart at entry time, which
-- is true of most rows.
--
-- `text` rather than `jsonb`: nothing ever queries into it (it decides a badge
-- and shows "was 650"), it compares with plain equality in the client's merge,
-- and it is one legible cell in the continuity workbook rather than a blob a
-- human cannot read in Excel. Contrast `profit_shares`, which IS structured
-- data the server may one day need to query into.
--
-- Provenance cannot be backfilled — once the chart moves, what it used to say
-- is gone. Rows imported from the client's workbook carry no such signal and
-- never can, so they stay NULL rather than guessing.
--
-- Written as `add column if not exists` so it applies whether or not 0001/0002
-- have already been run.

alter table public.ledger_rows
  add column if not exists rates_from text;

alter table public.party_rows
  add column if not exists rates_from text;

-- Re-declare both push functions to carry the new column. `nullif(…, '')` so a
-- blank arrives as NULL: an empty string would read as provenance that exists
-- but says nothing, and would then differ from an untouched row.

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
    quary_amount_override, vehicle_rent_override, rates_from,
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
    case when r -> 'quary_amount_override' is null
              or jsonb_typeof(r -> 'quary_amount_override') = 'null'
         then null else (r ->> 'quary_amount_override')::numeric end,
    case when r -> 'vehicle_rent_override' is null
              or jsonb_typeof(r -> 'vehicle_rent_override') = 'null'
         then null else (r ->> 'vehicle_rent_override')::numeric end,
    nullif(r ->> 'rates_from', ''),
    coalesce((r ->> 'draft')::boolean, false),
    coalesce((r ->> 'deleted')::boolean, false),
    coalesce((r ->> 'updated_at')::bigint, 0)
  from jsonb_array_elements(payload) as r
  where coalesce(r ->> 'id', '') <> ''
  on conflict (team_id, id) do update set
    account_id            = excluded.account_id,
    date                  = excluded.date,
    item                  = excluded.item,
    crusher               = excluded.crusher,
    pass_type             = excluded.pass_type,
    qty                   = excluded.qty,
    quary_rate            = excluded.quary_rate,
    crusher_rate          = excluded.crusher_rate,
    rent_rate             = excluded.rent_rate,
    comm_rate             = excluded.comm_rate,
    vehicle               = excluded.vehicle,
    quary_amount_override = excluded.quary_amount_override,
    vehicle_rent_override = excluded.vehicle_rent_override,
    rates_from            = excluded.rates_from,
    draft                 = excluded.draft,
    deleted               = excluded.deleted,
    updated_at            = excluded.updated_at
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
    with_rent, quary_rate, bill_rate, rent_rate, profit_shares, rates_from,
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
    nullif(r ->> 'rates_from', ''),
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
    rates_from    = excluded.rates_from,
    draft         = excluded.draft,
    deleted       = excluded.deleted,
    updated_at    = excluded.updated_at
  where excluded.updated_at > t.updated_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.push_ledger_rows(jsonb) from public;
revoke all on function public.push_party_rows(jsonb) from public;
grant execute on function public.push_ledger_rows(jsonb) to authenticated;
grant execute on function public.push_party_rows(jsonb) to authenticated;
