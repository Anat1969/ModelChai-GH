-- The concept's library: the visual prompts made from it, the images made from those prompts (uploaded by
-- the owner, from Midjourney or any other tool), and posts that read the concept as a building in its place.
create table public.mathcreator_library (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.mathcreator_projects(id) on delete cascade,
  version_id uuid references public.mathcreator_recipe_versions(id) on delete set null,
  kind text not null check (kind in ('prompt', 'image', 'post')),
  -- An image belongs to the prompt it was made from.
  prompt_id uuid references public.mathcreator_library(id) on delete cascade,
  -- The prompt's distilled sentence, or the post's short version.
  distill text check (distill is null or char_length(distill) <= 400),
  -- The prompt text, or the post itself.
  body text check (body is null or char_length(body) <= 4000),
  image_path text,
  created_at timestamptz not null default now(),
  check ((kind = 'image') = (image_path is not null)),
  check (kind <> 'image' or prompt_id is not null)
);
create index mathcreator_library_project_idx on public.mathcreator_library (project_id, created_at desc);
create index mathcreator_library_prompt_idx on public.mathcreator_library (prompt_id);
create index mathcreator_library_version_idx on public.mathcreator_library (version_id);

alter table public.mathcreator_library enable row level security;
create policy mathcreator_own_library on public.mathcreator_library
  for all to authenticated
  using (exists (select 1 from public.mathcreator_projects p where p.id = project_id and p.owner = (select auth.uid())))
  with check (exists (select 1 from public.mathcreator_projects p where p.id = project_id and p.owner = (select auth.uid())));

-- Images: private, up to 10 MB, one folder per user (<user id>/<project id>/<item id>.<ext>).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mathcreator-library', 'mathcreator-library', false, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy mathcreator_library_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'mathcreator-library' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy mathcreator_library_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mathcreator-library' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy mathcreator_library_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'mathcreator-library' and (storage.foldername(name))[1] = (select auth.uid())::text);
