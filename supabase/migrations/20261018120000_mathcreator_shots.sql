-- The views chosen for the clip (DECISIONS.md 128) live on the project, so they reach every device. Only the
-- plan is kept (positions, targets, level, seconds); thumbnails stay on the device and are drawn again.
alter table public.mathcreator_projects add column if not exists shots jsonb check (shots is null or pg_column_size(shots) < 100000);
