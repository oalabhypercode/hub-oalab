-- Client Hub file exchange: customers with customer numbers, which logins belong to them,
-- uploaded files with their metadata and the file-to-customer assignments.
-- Admins (app_metadata.app_role = 'oalab_admin', settable only with the service role) manage everything;
-- customers read only files assigned to a customer they belong to. Bytes live in the private bucket "hub-files".

create or replace function public.is_hub_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'oalab_admin', false);
$$;

create table public.hub_customers (
  id uuid primary key default gen_random_uuid(),
  customer_number text not null unique check (char_length(customer_number) between 1 and 40),
  company text not null check (char_length(company) between 1 and 200),
  created_at timestamptz not null default now()
);

create table public.hub_customer_members (
  customer_id uuid not null references public.hub_customers (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (customer_id, user_id)
);
create index hub_customer_members_user_idx on public.hub_customer_members (user_id);

create table public.hub_files (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  category text not null check (category in ('contract', 'offer', 'invoice', 'brand', 'design', 'website', 'documentation', 'other')),
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes between 0 and 52428800),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.hub_file_assignments (
  file_id uuid not null references public.hub_files (id) on delete cascade,
  customer_id uuid not null references public.hub_customers (id) on delete cascade,
  assigned_by uuid default auth.uid() references auth.users (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (file_id, customer_id)
);
create index hub_file_assignments_customer_idx on public.hub_file_assignments (customer_id);

alter table public.hub_customers enable row level security;
alter table public.hub_customer_members enable row level security;
alter table public.hub_files enable row level security;
alter table public.hub_file_assignments enable row level security;

create policy "Hub admins manage customers" on public.hub_customers
  for all to authenticated using ((select public.is_hub_admin())) with check ((select public.is_hub_admin()));
create policy "Members read their customer" on public.hub_customers
  for select to authenticated using (
    exists (select 1 from public.hub_customer_members m where m.customer_id = hub_customers.id and m.user_id = (select auth.uid()))
  );

create policy "Hub admins manage memberships" on public.hub_customer_members
  for all to authenticated using ((select public.is_hub_admin())) with check ((select public.is_hub_admin()));
create policy "Users read their memberships" on public.hub_customer_members
  for select to authenticated using (user_id = (select auth.uid()));

create policy "Hub admins manage files" on public.hub_files
  for all to authenticated using ((select public.is_hub_admin())) with check ((select public.is_hub_admin()));
create policy "Customers read assigned files" on public.hub_files
  for select to authenticated using (
    exists (
      select 1
      from public.hub_file_assignments a
      join public.hub_customer_members m on m.customer_id = a.customer_id
      where a.file_id = hub_files.id and m.user_id = (select auth.uid())
    )
  );

create policy "Hub admins manage assignments" on public.hub_file_assignments
  for all to authenticated using ((select public.is_hub_admin())) with check ((select public.is_hub_admin()));
create policy "Customers read their assignments" on public.hub_file_assignments
  for select to authenticated using (
    exists (select 1 from public.hub_customer_members m where m.customer_id = hub_file_assignments.customer_id and m.user_id = (select auth.uid()))
  );

-- Explicit Data API grants (tables are no longer exposed automatically from 30 October 2026).
revoke all on public.hub_customers, public.hub_customer_members, public.hub_files, public.hub_file_assignments from anon;
grant select, insert, update, delete on public.hub_customers, public.hub_customer_members, public.hub_files, public.hub_file_assignments to authenticated;
grant all on public.hub_customers, public.hub_customer_members, public.hub_files, public.hub_file_assignments to service_role;
revoke execute on function public.is_hub_admin() from public, anon;
grant execute on function public.is_hub_admin() to authenticated, service_role;

-- Private bucket; 50 MB per file. Downloads only through short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit)
values ('hub-files', 'hub-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy "Hub admins manage file objects" on storage.objects
  for all to authenticated
  using (bucket_id = 'hub-files' and (select public.is_hub_admin()))
  with check (bucket_id = 'hub-files' and (select public.is_hub_admin()));
create policy "Customers read assigned file objects" on storage.objects
  for select to authenticated using (
    bucket_id = 'hub-files'
    and exists (
      select 1
      from public.hub_files f
      join public.hub_file_assignments a on a.file_id = f.id
      join public.hub_customer_members m on m.customer_id = a.customer_id
      where f.storage_path = storage.objects.name and m.user_id = (select auth.uid())
    )
  );
