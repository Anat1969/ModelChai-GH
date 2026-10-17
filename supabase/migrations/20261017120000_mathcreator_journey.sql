-- The work path (DECISIONS.md 97): what the owner writes on each of the nine steps, and the edits to the
-- exhibition article, live on the project. Inspiration images and photos of the built model join the library.
alter table public.mathcreator_projects add column journey jsonb not null default '{}'::jsonb check (pg_column_size(journey) < 200000);
alter table public.mathcreator_projects add column article jsonb not null default '{}'::jsonb check (pg_column_size(article) < 200000);

alter table public.mathcreator_library drop constraint mathcreator_library_kind_check;
alter table public.mathcreator_library add constraint mathcreator_library_kind_check check (kind in ('prompt', 'image', 'post', 'reading', 'still', 'clip', 'print', 'dossier', 'reference', 'photo'));

alter table public.mathcreator_library drop constraint mathcreator_library_file_check;
alter table public.mathcreator_library add constraint mathcreator_library_file_check check ((kind in ('image', 'still', 'clip', 'print', 'dossier', 'reference', 'photo')) = (image_path is not null));
