-- The collection's clips and print files (DECISIONS.md 87, 88): two more kinds in the library, and the bucket
-- takes MP4 video and 3MF models up to 25 MB.
alter table public.mathcreator_library drop constraint mathcreator_library_kind_check;
alter table public.mathcreator_library add constraint mathcreator_library_kind_check check (kind in ('prompt', 'image', 'post', 'reading', 'still', 'clip', 'print'));

alter table public.mathcreator_library drop constraint mathcreator_library_file_check;
alter table public.mathcreator_library add constraint mathcreator_library_file_check check ((kind in ('image', 'still', 'clip', 'print')) = (image_path is not null));
alter table public.mathcreator_library add constraint mathcreator_library_media_check check (kind not in ('clip', 'print') or stage is not null);

update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'model/3mf']
where id = 'mathcreator-library';
