create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'demo-user',
  profile_id uuid not null references public.wardrobe_profiles(id) on delete cascade,
  provider text not null check (provider in ('google', 'outlook')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id, provider)
);

alter table public.calendar_connections enable row level security;

drop policy if exists "calendar connections service role" on public.calendar_connections;
create policy "calendar connections service role"
on public.calendar_connections
for all
using (true)
with check (true);

create index if not exists calendar_connections_profile_idx on public.calendar_connections(profile_id);
