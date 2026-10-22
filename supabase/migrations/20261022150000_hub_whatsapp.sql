-- Client Hub on WhatsApp: which WhatsApp number belongs to which login, short-lived link codes and a
-- short message history per number (context for follow-up questions, duplicate protection, daily limit).
-- Users see and remove only their own link and create codes only through hub_create_whatsapp_link_code();
-- everything else is written by the WhatsApp webhook with the service role.

create table public.hub_whatsapp_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- WhatsApp ID: the number in international format without "+" (e.g. 4915112345678).
  phone text not null unique check (phone ~ '^[1-9][0-9]{6,14}$'),
  linked_at timestamptz not null default now()
);

create table public.hub_whatsapp_link_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique check (code ~ '^[0-9]{6}$'),
  expires_at timestamptz not null
);

create table public.hub_whatsapp_messages (
  -- WhatsApp message id for incoming messages, so a repeated delivery is stored (and answered) only once.
  id text primary key default gen_random_uuid()::text,
  phone text not null check (phone ~ '^[1-9][0-9]{6,14}$'),
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 4096),
  created_at timestamptz not null default now()
);
create index hub_whatsapp_messages_phone_idx on public.hub_whatsapp_messages (phone, created_at);
create index hub_whatsapp_messages_created_idx on public.hub_whatsapp_messages (created_at);

alter table public.hub_whatsapp_links enable row level security;
alter table public.hub_whatsapp_link_codes enable row level security;
alter table public.hub_whatsapp_messages enable row level security;

create policy "Users read their WhatsApp link" on public.hub_whatsapp_links
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users remove their WhatsApp link" on public.hub_whatsapp_links
  for delete to authenticated using (user_id = (select auth.uid()));
-- Link codes and messages have no policies: only the service role (webhook) reads and writes them.

-- A fresh six-digit code for the signed-in user, valid for 15 minutes; replaces an earlier one.
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
  if current_user_id is null then
    raise exception 'not signed in' using errcode = '42501';
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

-- Explicit Data API grants (tables are no longer exposed automatically from 30 October 2026).
revoke all on public.hub_whatsapp_links, public.hub_whatsapp_link_codes, public.hub_whatsapp_messages from anon, authenticated;
grant select, delete on public.hub_whatsapp_links to authenticated;
grant all on public.hub_whatsapp_links, public.hub_whatsapp_link_codes, public.hub_whatsapp_messages to service_role;
revoke execute on function public.hub_create_whatsapp_link_code() from public, anon;
grant execute on function public.hub_create_whatsapp_link_code() to authenticated, service_role;
