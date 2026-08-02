-- Typed-over settlement amounts.
--
-- The business adjusts what it actually settles with the quarry — a negotiated
-- figure, a slip-weight difference, a rounding at the quarry's end — and that
-- adjusted amount is the real one. In the source workbook this shows up on 811
-- of 1803 loads, averaging a couple of hundred rupees away from
-- ROUND(qty * quary_rate, -1), so it is nothing like a rounding artefact.
--
-- A rate override cannot express it: round10 always yields a multiple of 10,
-- and real settlements are not. Hence an explicit amount.
--
-- This does not contradict "no derived values on the server". A figure the user
-- deliberately typed is an INPUT — the same standing a snapshotted rate has.
-- NULL means "compute it", which is why both columns are nullable and why
-- 0 is a meaningful value distinct from absent.
--
-- Written as `add column if not exists` so it applies whether or not 0001 has
-- already been run.

alter table public.ledger_rows
  add column if not exists quary_amount_override numeric,
  add column if not exists vehicle_rent_override numeric;

-- Re-declare the push function to carry the new columns. `->` rather than `->>`
-- for the null test, so a JSON null and an absent key both land as SQL NULL
-- instead of being coerced to 0.
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
    quary_amount_override, vehicle_rent_override,
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
    draft                 = excluded.draft,
    deleted               = excluded.deleted,
    updated_at            = excluded.updated_at
  where excluded.updated_at > t.updated_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.push_ledger_rows(jsonb) from public;
grant execute on function public.push_ledger_rows(jsonb) to authenticated;
