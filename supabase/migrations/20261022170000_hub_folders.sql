-- Folders in the file exchange: one level of folders per customer. Customers create, rename and delete
-- the folders of their own customer and move their files between them; admins do the same for every customer.
-- A file's folder belongs to its assignment, so a file shared with two customers can sit in a different
-- folder for each. Deleting a folder moves its files back to "Ohne Ordner"; no file is deleted.

create table public.hub_folders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.hub_customers (id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 80),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint hub_folders_unique_name unique (customer_id, name),
  -- Target of the assignment's composite reference, which keeps a file in a folder of the same customer.
  constraint hub_folders_customer_key unique (id, customer_id)
);

alter table public.hub_file_assignments add column folder_id uuid;
alter table public.hub_file_assignments add constraint hub_file_assignments_folder_fkey
  foreign key (folder_id, customer_id) references public.hub_folders (id, customer_id) on delete set null (folder_id);
create index hub_file_assignments_folder_idx on public.hub_file_assignments (folder_id);

alter table public.hub_folders enable row level security;

create policy "Hub admins manage folders" on public.hub_folders
  for all to authenticated using ((select public.is_hub_admin())) with check ((select public.is_hub_admin()));
create policy "Members manage their customer's folders" on public.hub_folders
  for all to authenticated
  using (exists (select 1 from public.hub_customer_members m where m.customer_id = hub_folders.customer_id and m.user_id = (select auth.uid())))
  with check (exists (select 1 from public.hub_customer_members m where m.customer_id = hub_folders.customer_id and m.user_id = (select auth.uid())));

-- Customers may file their own assignments; the column grant below limits them to the folder.
create policy "Members file their assignments" on public.hub_file_assignments
  for update to authenticated
  using (exists (select 1 from public.hub_customer_members m where m.customer_id = hub_file_assignments.customer_id and m.user_id = (select auth.uid())))
  with check (exists (select 1 from public.hub_customer_members m where m.customer_id = hub_file_assignments.customer_id and m.user_id = (select auth.uid())));

-- Explicit Data API grants (tables are no longer exposed automatically from 30 October 2026).
revoke all on public.hub_folders from anon;
grant select, insert, update, delete on public.hub_folders to authenticated;
grant all on public.hub_folders to service_role;
-- Assignments are changed only by moving them to a folder; admins replace assignments with delete and insert.
revoke update on public.hub_file_assignments from authenticated;
grant update (folder_id) on public.hub_file_assignments to authenticated;
