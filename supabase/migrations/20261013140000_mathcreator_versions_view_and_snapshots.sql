-- Stage 5: what a version needs to reopen exactly as it was saved, and where its snapshot lives.

-- The camera and the level at save time. Kept beside the recipe, not inside it: the recipe contract
-- (recipe.schema.json) describes the structure; how it was being looked at is a property of the version.
alter table public.mathcreator_recipe_versions
  add column view jsonb check (view is null or jsonb_typeof(view) = 'object');

-- Snapshots: private, PNG only, up to 2 MB, one folder per user (<user id>/<version id>.png).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mathcreator-snapshots', 'mathcreator-snapshots', false, 2097152, array['image/png'])
on conflict (id) do nothing;

create policy mathcreator_snapshots_select on storage.objects
  for select to authenticated
  using (bucket_id = 'mathcreator-snapshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy mathcreator_snapshots_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mathcreator-snapshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy mathcreator_snapshots_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'mathcreator-snapshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
