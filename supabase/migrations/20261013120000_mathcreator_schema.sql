-- Math Creator (יוצר: מתמטיקה) schema, from docs/ARCHITECTURE.md section 4.
-- The Supabase project is shared with other apps, so every object carries the mathcreator_ prefix
-- (docs/DECISIONS.md). Versions are immutable: there is no update policy on recipe_versions.

create table public.mathcreator_projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  concept text not null check (char_length(concept) between 1 and 120),
  title_he text not null check (char_length(title_he) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index mathcreator_projects_owner_idx on public.mathcreator_projects (owner, updated_at desc);

create table public.mathcreator_recipe_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.mathcreator_projects(id) on delete cascade,
  parent_id uuid references public.mathcreator_recipe_versions(id),
  recipe jsonb not null,
  schema_version text not null,
  note text check (note is null or char_length(note) <= 280),
  created_at timestamptz not null default now()
);
create index mathcreator_recipe_versions_project_idx on public.mathcreator_recipe_versions (project_id, created_at desc);
create index mathcreator_recipe_versions_parent_idx on public.mathcreator_recipe_versions (parent_id);

create table public.mathcreator_snapshots (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.mathcreator_recipe_versions(id) on delete cascade,
  image_path text not null,
  visual_prompt text,
  level text not null check (level in ('bare', 'realistic')),
  created_at timestamptz not null default now()
);
create index mathcreator_snapshots_version_idx on public.mathcreator_snapshots (version_id);

-- One row per concept-to-recipe call: the rate limit (20 per hour) and the record of how well
-- the translation works (first-try rate, repairs, time), which PRODUCT.md sets as success metrics.
create table public.mathcreator_ai_calls (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  concept text not null check (char_length(concept) between 1 and 120),
  model text not null,
  ok boolean not null,
  attempts int not null check (attempts between 0 and 3),
  first_try_ok boolean not null,
  duration_ms int not null,
  issues jsonb not null default '[]'::jsonb,
  recipe jsonb,
  created_at timestamptz not null default now()
);
create index mathcreator_ai_calls_owner_idx on public.mathcreator_ai_calls (owner, created_at desc);

create or replace function public.mathcreator_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger mathcreator_projects_touch
before update on public.mathcreator_projects
for each row execute function public.mathcreator_touch_updated_at();

alter table public.mathcreator_projects enable row level security;
alter table public.mathcreator_recipe_versions enable row level security;
alter table public.mathcreator_snapshots enable row level security;
alter table public.mathcreator_ai_calls enable row level security;

create policy mathcreator_own_projects on public.mathcreator_projects
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

create policy mathcreator_own_versions_select on public.mathcreator_recipe_versions
  for select to authenticated
  using (exists (select 1 from public.mathcreator_projects p where p.id = project_id and p.owner = (select auth.uid())));
create policy mathcreator_own_versions_insert on public.mathcreator_recipe_versions
  for insert to authenticated
  with check (exists (select 1 from public.mathcreator_projects p where p.id = project_id and p.owner = (select auth.uid())));
create policy mathcreator_own_versions_delete on public.mathcreator_recipe_versions
  for delete to authenticated
  using (exists (select 1 from public.mathcreator_projects p where p.id = project_id and p.owner = (select auth.uid())));

create policy mathcreator_own_snapshots on public.mathcreator_snapshots
  for all to authenticated
  using (exists (
    select 1 from public.mathcreator_recipe_versions v
    join public.mathcreator_projects p on p.id = v.project_id
    where v.id = version_id and p.owner = (select auth.uid())))
  with check (exists (
    select 1 from public.mathcreator_recipe_versions v
    join public.mathcreator_projects p on p.id = v.project_id
    where v.id = version_id and p.owner = (select auth.uid())));

-- Calls are written by the Edge Function with the caller's own token, and are never edited.
create policy mathcreator_own_ai_calls_select on public.mathcreator_ai_calls
  for select to authenticated
  using (owner = (select auth.uid()));
create policy mathcreator_own_ai_calls_insert on public.mathcreator_ai_calls
  for insert to authenticated
  with check (owner = (select auth.uid()));
