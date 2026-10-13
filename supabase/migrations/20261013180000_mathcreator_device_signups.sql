-- Device accounts: no email, no password to remember. Each signup is logged by a hash of the caller's
-- address, so the function can limit how many accounts one address (and everyone) can create per hour.
create table public.mathcreator_device_signups (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index mathcreator_device_signups_idx on public.mathcreator_device_signups (ip_hash, created_at desc);
-- Only the server function (service role) reads or writes it: RLS on, no policies.
alter table public.mathcreator_device_signups enable row level security;
