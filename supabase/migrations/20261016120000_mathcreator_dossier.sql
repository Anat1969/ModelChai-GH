-- The project's document (DECISIONS.md 94): a flyer and dossier made from the collection, kept in the collection
-- as PDF and Word, so it can be shared by a link. One more kind in the library; the bucket takes both formats.
alter table public.mathcreator_library drop constraint mathcreator_library_kind_check;
alter table public.mathcreator_library add constraint mathcreator_library_kind_check check (kind in ('prompt', 'image', 'post', 'reading', 'still', 'clip', 'print', 'dossier'));

alter table public.mathcreator_library drop constraint mathcreator_library_file_check;
alter table public.mathcreator_library add constraint mathcreator_library_file_check check ((kind in ('image', 'still', 'clip', 'print', 'dossier')) = (image_path is not null));

update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'model/3mf', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
where id = 'mathcreator-library';
