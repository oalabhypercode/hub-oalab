-- Client Hub user management: every login gets a profile, self-registered logins wait for an admin's approval,
-- admins create logins and customers, and every admin action lands in an append-only log.
-- Only *active* profiles reach data: is_hub_admin() and the membership rows that open customer data check the
-- status (and is_hub_admin() the role) in the database, so a deactivation or role change takes effect at once
-- instead of when the access token expires.
-- Profiles, customers and the log are written only by the server with the service role, after it has checked
-- with the admin's own session that the database considers them an active admin.

-- Profiles ---------------------------------------------------------------------------------------------------------

create table public.hub_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null default '' check (char_length(first_name) <= 80),
  last_name text not null default '' check (char_length(last_name) <= 80),
  phone text not null default '' check (char_length(phone) <= 40),
  position text not null default '' check (char_length(position) <= 80),
  -- What the person stated when registering. The customer a login belongs to lives in hub_customer_members.
  company_name text not null default '' check (char_length(company_name) <= 200),
  website text not null default '' check (char_length(website) <= 200),
  customer_number_hint text not null default '' check (char_length(customer_number_hint) <= 40),
  message text not null default '' check (char_length(message) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled', 'rejected')),
  source text not null default 'registration' check (source in ('registration', 'admin', 'existing')),
  privacy_noted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  -- Shown to the person on the waiting page, e.g. the reason for a rejection.
  decision_note text not null default '' check (char_length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hub_profiles_status_idx on public.hub_profiles (status);

create trigger hub_profiles_touch before update on public.hub_profiles
  for each row execute function public.hub_touch_updated_at();

-- True when the signed-in login has an active profile. Security definer, so policies on other tables can use it
-- without recursion; it only ever answers for auth.uid().
create or replace function public.hub_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.hub_profiles p where p.user_id = (select auth.uid()) and p.status = 'active');
$$;

-- Admins need the admin role on their login *and* an active profile. Both are read from the database, not from
-- the access token, so a role change or a deactivation applies to the very next request.
create or replace function public.is_hub_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.hub_profiles p on p.user_id = u.id
    where u.id = (select auth.uid())
      and p.status = 'active'
      and coalesce(u.raw_app_meta_data ->> 'app_role', '') = 'oalab_admin'
  );
$$;

-- Every new login gets a profile. Self-registrations wait for approval; logins created with a role (admin API,
-- seed) are active. Only the service role can set app_metadata, so a registration cannot grant itself a role.
-- user_metadata comes from the registration form: it is trimmed and cut to the column limits, never trusted.
create or replace function public.hub_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  full_name text := btrim(coalesce(meta ->> 'full_name', ''));
  has_role boolean := coalesce(new.raw_app_meta_data ->> 'app_role', '') in ('oalab_admin', 'oalab_customer');
begin
  insert into public.hub_profiles (
    user_id, first_name, last_name, phone, position, company_name, website, customer_number_hint, message,
    status, source, privacy_noted_at
  ) values (
    new.id,
    left(btrim(coalesce(nullif(meta ->> 'first_name', ''), split_part(full_name, ' ', 1))), 80),
    left(btrim(coalesce(nullif(meta ->> 'last_name', ''), nullif(btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), ''), '')), 80),
    left(btrim(coalesce(meta ->> 'phone', '')), 40),
    left(btrim(coalesce(meta ->> 'position', '')), 80),
    left(btrim(coalesce(nullif(meta ->> 'company_name', ''), meta ->> 'company', '')), 200),
    left(btrim(coalesce(meta ->> 'website', '')), 200),
    left(btrim(coalesce(meta ->> 'customer_number_hint', '')), 40),
    left(btrim(coalesce(meta ->> 'message', '')), 1000),
    case when has_role then 'active' else 'pending' end,
    case when has_role then 'admin' else 'registration' end,
    case when coalesce(meta ->> 'privacy_noted', '') = 'true' then now() end
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger hub_on_auth_user_created after insert on auth.users
  for each row execute function public.hub_handle_new_user();

-- Logins that existed before: with a hub role they stay active, without one they now wait for approval.
insert into public.hub_profiles (user_id, first_name, last_name, company_name, status, source)
select
  u.id,
  left(split_part(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ' ', 1), 80),
  left(btrim(substr(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), length(split_part(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ' ', 1)) + 1)), 80),
  left(btrim(coalesce(u.raw_user_meta_data ->> 'company', '')), 200),
  case when coalesce(u.raw_app_meta_data ->> 'app_role', '') in ('oalab_admin', 'oalab_customer') then 'active' else 'pending' end,
  'existing'
from auth.users u
on conflict (user_id) do nothing;

alter table public.hub_profiles enable row level security;
create policy "Users read their profile" on public.hub_profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Hub admins read profiles" on public.hub_profiles
  for select to authenticated using ((select public.is_hub_admin()));

-- Customers --------------------------------------------------------------------------------------------------------

alter table public.hub_customers
  add column service_packages text[] not null default '{}'
    check (service_packages <@ array['website-mail', 'website-lite', 'website-extra', 'website-max']::text[]),
  add column contact_email text not null default '' check (char_length(contact_email) <= 254),
  add column phone text not null default '' check (char_length(phone) <= 40),
  add column website text not null default '' check (char_length(website) <= 200),
  add column street text not null default '' check (char_length(street) <= 120),
  add column postal_code text not null default '' check (char_length(postal_code) <= 12),
  add column city text not null default '' check (char_length(city) <= 80),
  add column country text not null default 'Deutschland' check (char_length(country) <= 60),
  add column updated_at timestamptz not null default now();

create trigger hub_customers_touch before update on public.hub_customers
  for each row execute function public.hub_touch_updated_at();

-- The three fictional demo customers keep the packages their demo workspaces already show.
update public.hub_customers set service_packages = array['website-extra'] where customer_number = 'KD-24017' and service_packages = '{}';
update public.hub_customers set service_packages = array['website-lite'] where customer_number = 'KD-24023' and service_packages = '{}';
update public.hub_customers set service_packages = array['website-max'] where customer_number = 'KD-24031' and service_packages = '{}';

-- Memberships open every customer's data (files, folders, appointments, the customer itself). Reading them now
-- needs an active profile, so a deactivated login loses access with its next request.
drop policy "Users read their memberships" on public.hub_customer_members;
create policy "Active users read their memberships" on public.hub_customer_members
  for select to authenticated using (user_id = (select auth.uid()) and (select public.hub_is_active()));

-- Admin log --------------------------------------------------------------------------------------------------------

-- Append-only: who did what to which login or customer. The summary carries no personal data, so the log may
-- outlive a deleted login (its reference is then cleared).
create table public.hub_admin_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users (id) on delete set null,
  target_user_id uuid references auth.users (id) on delete set null,
  target_customer_id uuid references public.hub_customers (id) on delete set null,
  action text not null check (char_length(action) between 1 and 60),
  summary text not null default '' check (char_length(summary) <= 300)
);
create index hub_admin_events_user_idx on public.hub_admin_events (target_user_id, created_at desc);
create index hub_admin_events_customer_idx on public.hub_admin_events (target_customer_id, created_at desc);

alter table public.hub_admin_events enable row level security;
create policy "Hub admins read the admin log" on public.hub_admin_events
  for select to authenticated using ((select public.is_hub_admin()));

-- Existing functions: only active logins ---------------------------------------------------------------------------

-- Booked times of the whole calendar, without titles, customers or links. Active logins, at most 400 days per call.
create or replace function public.hub_calendar_busy(range_start timestamptz, range_end timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.starts_at, a.ends_at
  from public.hub_appointments a
  where (select public.hub_is_active())
    and range_end - range_start <= interval '400 days'
    and a.status = 'confirmed'
    and a.starts_at < range_end
    and a.ends_at > range_start
  order by a.starts_at;
$$;

-- Customers withdraw their own open request; nothing else about the row can change this way.
create or replace function public.hub_withdraw_appointment_request(appointment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.hub_appointments a
  set status = 'cancelled'
  where a.id = appointment_id
    and a.status = 'requested'
    and (select public.hub_is_active())
    and exists (select 1 from public.hub_customer_members m where m.customer_id = a.customer_id and m.user_id = (select auth.uid()));
  return found;
end;
$$;

-- A fresh six-digit code for the signed-in, active user, valid for 15 minutes; replaces an earlier one.
create or replace function public.hub_create_whatsapp_link_code()
returns table (code text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_code text;
  valid_until timestamptz := now() + interval '15 minutes';
begin
  if current_user_id is null or not public.hub_is_active() then
    raise exception 'not an active login' using errcode = '42501';
  end if;
  delete from public.hub_whatsapp_link_codes c where c.expires_at < now();
  loop
    -- gen_random_uuid() draws from the strong random source; 32 bits of it make the code.
    new_code := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000))::text, 6, '0');
    begin
      insert into public.hub_whatsapp_link_codes as c (user_id, code, expires_at)
      values (current_user_id, new_code, valid_until)
      on conflict on constraint hub_whatsapp_link_codes_pkey do update set code = excluded.code, expires_at = excluded.expires_at;
      exit;
    exception when unique_violation then
      -- Another user holds this code right now: draw again.
    end;
  end loop;
  return query select new_code, valid_until;
end;
$$;

-- Grants -----------------------------------------------------------------------------------------------------------

-- Explicit Data API grants (tables are no longer exposed automatically from 30 October 2026). Browsers only read;
-- every write goes through the server.
revoke all on public.hub_profiles, public.hub_admin_events from anon, authenticated;
grant select on public.hub_profiles, public.hub_admin_events to authenticated;
grant all on public.hub_profiles, public.hub_admin_events to service_role;
revoke execute on function public.hub_is_active() from public, anon;
grant execute on function public.hub_is_active() to authenticated, service_role;
revoke execute on function public.hub_handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_hub_admin() from public, anon;
grant execute on function public.is_hub_admin() to authenticated, service_role;
