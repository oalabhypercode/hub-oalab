-- One login for Hub OALab and Service OALab (25.10.2026): the Hub now runs on the Service Supabase project, which
-- versions the shared schema. This change is applied there through service-oalab
-- (supabase/migrations/202610250001_hub_schema.sql, together with the six Hub migrations before it). It is kept here
-- so this history matches the schema the Hub code expects; `npm run db:push` no longer applies anything.

-- Public sign-ups stay closed in the shared project: the Hub creates a registration with the service role and sends
-- the confirmation link itself, so its mail log needs that kind.
alter table public.hub_notifications drop constraint hub_notifications_kind_check;
alter table public.hub_notifications add constraint hub_notifications_kind_check check (
  kind in ('registration.confirmation', 'registration.team', 'registration.received', 'registration.approved', 'registration.rejected', 'user.activation', 'user.password')
);

-- Server-side rate limit for the anonymous auth forms (login, registration, password link). The Hub signs in on the
-- server, so Supabase Auth only sees the server's address. Subjects are SHA-256 hashes, never addresses.
create table public.hub_auth_rate_events (
  id bigint generated always as identity primary key,
  action text not null check (action in ('login', 'signup', 'password_reset')),
  subject text not null check (subject ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index hub_auth_rate_events_lookup_idx on public.hub_auth_rate_events (action, subject, created_at desc);
alter table public.hub_auth_rate_events enable row level security;
alter table public.hub_auth_rate_events force row level security;
revoke all on public.hub_auth_rate_events from public, anon, authenticated;
grant all on public.hub_auth_rate_events to service_role;

-- True (and counted) while the subject stays below the limit in the window; false once it is reached.
create or replace function public.hub_take_auth_rate(p_action text, p_subject text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  used integer;
begin
  if p_action not in ('login', 'signup', 'password_reset') or p_subject !~ '^[0-9a-f]{64}$'
     or p_limit not between 1 and 1000 or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid rate limit request' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_action || ':' || p_subject, 0));
  delete from public.hub_auth_rate_events e where e.created_at < now() - interval '1 day';
  select count(*) into used
  from public.hub_auth_rate_events e
  where e.action = p_action and e.subject = p_subject and e.created_at > now() - make_interval(secs => p_window_seconds);
  if used >= p_limit then
    return false;
  end if;
  insert into public.hub_auth_rate_events (action, subject) values (p_action, p_subject);
  return true;
end;
$$;
revoke execute on function public.hub_take_auth_rate(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.hub_take_auth_rate(text, text, integer, integer) to service_role;
