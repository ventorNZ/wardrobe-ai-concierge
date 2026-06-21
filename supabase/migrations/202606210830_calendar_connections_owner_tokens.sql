create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  profile_id uuid not null references public.wardrobe_profiles(id) on delete cascade,
  provider text not null check (provider in ('google', 'outlook')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.calendar_connections
  add column if not exists owner_id text;

update public.calendar_connections
set owner_id = coalesce(nullif(owner_id, ''), 'legacy-owner')
where owner_id is null or owner_id = '';

alter table public.calendar_connections
  alter column owner_id set not null;

alter table public.calendar_connections
  add column if not exists email text;

alter table public.calendar_connections
  add column if not exists expires_at timestamptz;

-- v7 used a profile/provider-only unique key, which prevents multiple real users from connecting calendars.
alter table public.calendar_connections
  drop constraint if exists calendar_connections_profile_id_provider_key;

drop index if exists calendar_connections_profile_provider_uidx;
create unique index if not exists calendar_connections_owner_profile_provider_uidx
  on public.calendar_connections(owner_id, profile_id, provider);

create index if not exists calendar_connections_owner_profile_idx
  on public.calendar_connections(owner_id, profile_id);

create index if not exists calendar_connections_profile_idx
  on public.calendar_connections(profile_id);

alter table public.calendar_connections enable row level security;

drop policy if exists "calendar connections service role" on public.calendar_connections;
create policy "calendar connections service role"
on public.calendar_connections
for all
using (true)
with check (true);
