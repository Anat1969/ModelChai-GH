-- A reading: the concept from mathematics to architecture (logic, space, figure-ground, synthesis).
alter table public.mathcreator_library drop constraint mathcreator_library_kind_check;
alter table public.mathcreator_library add constraint mathcreator_library_kind_check check (kind in ('prompt', 'image', 'post', 'reading'));
