-- Client Hub calendar: OALAB appointments (optionally for a customer, with a Microsoft Teams link)
-- and appointment requests from customers. Admins (app_metadata.app_role = 'oalab_admin') manage everything;
-- customers read their own appointments, create requests and may withdraw open ones.
-- How busy the OALAB calendar is reaches customers only as anonymous time blocks through hub_calendar_busy().

create table public.hub_appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.hub_customers (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'declined', 'cancelled')),
  teams_url text check (
    char_length(teams_url) <= 2048
    and teams_url ~ '^https://(teams\.microsoft\.com|teams\.live\.com|teams\.cloud\.microsoft|gov\.teams\.microsoft\.us|dod\.teams\.microsoft\.us)/.'
  ),
  response_note text not null default '' check (char_length(response_note) <= 1000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_appointments_duration check (ends_at > starts_at and ends_at - starts_at <= interval '12 hours'),
  constraint hub_appointments_request_customer check (status <> 'requested' or customer_id is not null)
);
create index hub_appointments_time_idx on public.hub_appointments (starts_at, ends_at);
create index hub_appointments_customer_idx on public.hub_appointments (customer_id);

create or replace function public.hub_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger hub_appointments_touch before update on public.hub_appointments
  for each row execute function public.hub_touch_updated_at();

alter table public.hub_appointments enable row level security;

create policy "Hub admins manage appointments" on public.hub_appointments
  for all to authenticated using ((select public.is_hub_admin())) with check ((select public.is_hub_admin()));
create policy "Customers read their appointments" on public.hub_appointments
  for select to authenticated using (
    exists (select 1 from public.hub_customer_members m where m.customer_id = hub_appointments.customer_id and m.user_id = (select auth.uid()))
  );
create policy "Customers request appointments" on public.hub_appointments
  for insert to authenticated with check (
    status = 'requested'
    and teams_url is null
    and response_note = ''
    and created_by = (select auth.uid())
    and exists (select 1 from public.hub_customer_members m where m.customer_id = hub_appointments.customer_id and m.user_id = (select auth.uid()))
  );

-- Booked times of the whole calendar, without titles, customers or links. Any signed-in user, at most 400 days per call.
create or replace function public.hub_calendar_busy(range_start timestamptz, range_end timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.starts_at, a.ends_at
  from public.hub_appointments a
  where (select auth.uid()) is not null
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
    and exists (select 1 from public.hub_customer_members m where m.customer_id = a.customer_id and m.user_id = (select auth.uid()));
  return found;
end;
$$;

-- Explicit Data API grants (tables are no longer exposed automatically from 30 October 2026).
revoke all on public.hub_appointments from anon;
grant select, insert, update, delete on public.hub_appointments to authenticated;
grant all on public.hub_appointments to service_role;
revoke execute on function public.hub_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.hub_calendar_busy(timestamptz, timestamptz), public.hub_withdraw_appointment_request(uuid) from public, anon;
grant execute on function public.hub_calendar_busy(timestamptz, timestamptz), public.hub_withdraw_appointment_request(uuid) to authenticated, service_role;
