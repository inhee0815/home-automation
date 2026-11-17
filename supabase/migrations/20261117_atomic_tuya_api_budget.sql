-- Apply to a dedicated Supabase Postgres project before connecting Netlify.
-- Exactly one reservation per application-side Tuya HTTP request, UTC day.
-- Atomic UPSERT: concurrent calls serialize on the primary-key row.
-- Provider-side or other-app Tuya calls are outside this guard.
create table if not exists public.tuya_api_daily_budget (
  utc_day date primary key,
  used integer not null check (used >= 0),
  cap integer not null check (cap between 1 and 20),
  updated_at timestamptz not null default now()
);
alter table public.tuya_api_daily_budget enable row level security;
revoke all on table public.tuya_api_daily_budget from public, anon, authenticated;
grant select on table public.tuya_api_daily_budget to service_role;

create or replace function public.reserve_tuya_api_call(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  day_utc date := (now() at time zone 'UTC')::date;
  new_used integer;
  effective_cap integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'invalid budget' using errcode='22023';
  end if;
  insert into public.tuya_api_daily_budget as b (utc_day, used, cap)
    values (day_utc, 1, p_limit)
    on conflict (utc_day)
      do update set used = b.used + 1,
                    cap = least(b.cap, excluded.cap),
                    updated_at = now()
      where b.used < least(b.cap, excluded.cap)
    returning used, cap into new_used, effective_cap;

  if new_used is null then
    return jsonb_build_object('allowed', false);
  end if;
  return jsonb_build_object('allowed', true, 'used', new_used, 'cap', effective_cap, 'day', day_utc);
end
$$;
revoke all on function public.reserve_tuya_api_call(integer) from public, anon, authenticated;
grant execute on function public.reserve_tuya_api_call(integer) to service_role;
