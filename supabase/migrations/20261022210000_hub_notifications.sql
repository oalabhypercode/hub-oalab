-- Client Hub e-mail notifications: which kind of mail went to which login and how it ended. No addresses,
-- subjects or contents, only the kind and the outcome, so the log may outlive a deleted login.
-- Mails that go out once per login (team notice and receipt for a registration) claim their row before sending;
-- the unique index makes a second claim fail, so a reload or two requests at once never send twice. A failed
-- attempt frees the claim for the next try. Written only by the server with the service role.

create table public.hub_notifications (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('registration.team', 'registration.received', 'registration.approved', 'registration.rejected', 'user.activation', 'user.password')),
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'skipped', 'failed')),
  provider_id text check (char_length(provider_id) <= 100),
  error text not null default '' check (char_length(error) <= 300),
  updated_at timestamptz not null default now()
);
create unique index hub_notifications_once_idx on public.hub_notifications (kind, user_id)
  where kind in ('registration.team', 'registration.received') and status <> 'failed';
create index hub_notifications_user_idx on public.hub_notifications (user_id, created_at desc);

create trigger hub_notifications_touch before update on public.hub_notifications
  for each row execute function public.hub_touch_updated_at();

alter table public.hub_notifications enable row level security;
create policy "Hub admins read notifications" on public.hub_notifications
  for select to authenticated using ((select public.is_hub_admin()));

-- Explicit Data API grants: browsers only read (admins, through the policy); the server writes.
revoke all on public.hub_notifications from anon, authenticated;
grant select on public.hub_notifications to authenticated;
grant all on public.hub_notifications to service_role;
