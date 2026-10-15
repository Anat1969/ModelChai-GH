-- The collection (DECISIONS.md 84): a frozen view of the model window, on its step of the way from the concept
-- to the printed model, with the camera that made it. Stills live with the library's images, in the same bucket.
alter table public.mathcreator_library drop constraint mathcreator_library_kind_check;
alter table public.mathcreator_library add constraint mathcreator_library_kind_check check (kind in ('prompt', 'image', 'post', 'reading', 'still'));

alter table public.mathcreator_library drop constraint mathcreator_library_check;
alter table public.mathcreator_library add constraint mathcreator_library_file_check check ((kind in ('image', 'still')) = (image_path is not null));

alter table public.mathcreator_library add column stage text check (stage is null or stage in ('concept', 'recipe', 'bare', 'realistic', 'render', 'print'));
-- Level and camera, as in mathcreator_recipe_versions.view, so the view opens again as it was frozen.
alter table public.mathcreator_library add column view jsonb;
alter table public.mathcreator_library add constraint mathcreator_library_still_check check (kind <> 'still' or (stage is not null and view is not null));
