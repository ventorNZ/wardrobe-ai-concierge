-- Wardrobe AI Concierge consolidated database schema / migration
-- Safe to run multiple times in Supabase SQL Editor.
-- Adds profiles, multi-angle item photos, merge support, saved stylist sessions, and per-outfit previews.

create extension if not exists pgcrypto;

create table if not exists wardrobe_items (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'demo-user',
  name text not null,
  category text not null default 'other',
  brand text,
  colour text,
  size_label text,
  season text,
  formality text,
  tags text[] default '{}',
  image_url text not null,
  storage_path text,
  created_at timestamptz not null default now()
);

-- Original enrichment columns for AI wardrobe ingestion.
alter table wardrobe_items add column if not exists subcategory text;
alter table wardrobe_items add column if not exists colour_primary text;
alter table wardrobe_items add column if not exists colour_secondary text;
alter table wardrobe_items add column if not exists pattern text;
alter table wardrobe_items add column if not exists fabric_guess text;
alter table wardrobe_items add column if not exists fit_type text;
alter table wardrobe_items add column if not exists fit_status text default 'fits_currently';
alter table wardrobe_items add column if not exists season_tags text[] default '{}';
alter table wardrobe_items add column if not exists formality_score integer;
alter table wardrobe_items add column if not exists warmth_score integer;
alter table wardrobe_items add column if not exists weather_suitability text[] default '{}';
alter table wardrobe_items add column if not exists style_tags text[] default '{}';
alter table wardrobe_items add column if not exists condition_notes text;
alter table wardrobe_items add column if not exists ai_summary text;
alter table wardrobe_items add column if not exists ai_confidence numeric;
alter table wardrobe_items add column if not exists classification_status text default 'manual';
alter table wardrobe_items add column if not exists classification_error text;
alter table wardrobe_items add column if not exists laundry_status text default 'clean';
alter table wardrobe_items add column if not exists last_worn_at timestamptz;
alter table wardrobe_items add column if not exists wear_count integer not null default 0;
alter table wardrobe_items add column if not exists updated_at timestamptz not null default now();

-- Profiles: Manny and Yess can share the app without mixing wardrobes or body references.
create table if not exists wardrobe_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'demo-user',
  display_name text not null,
  relationship text,
  style_profile text,
  default_body_item_id uuid references wardrobe_items(id) on delete set null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table wardrobe_items add column if not exists profile_id uuid references wardrobe_profiles(id) on delete set null;

-- Multi-angle/canonical-item support.
alter table wardrobe_items add column if not exists is_archived boolean not null default false;
alter table wardrobe_items add column if not exists canonical_item_id uuid references wardrobe_items(id) on delete set null;
alter table wardrobe_items add column if not exists angle_count integer not null default 1;
alter table wardrobe_items add column if not exists image_role text default 'primary';

create table if not exists wardrobe_item_photos (
  id uuid primary key default gen_random_uuid(),
  wardrobe_item_id uuid not null references wardrobe_items(id) on delete cascade,
  image_url text not null,
  storage_path text,
  source_item_id uuid references wardrobe_items(id) on delete set null,
  angle_label text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

-- Legacy generation history table retained for compatibility.
create table if not exists outfit_generations (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'demo-user',
  title text,
  occasion text,
  weather text,
  notes text,
  stylist_brief text,
  body_item_id uuid references wardrobe_items(id) on delete set null,
  selected_item_ids uuid[] not null,
  output_image_url text,
  output_base64 text,
  rating numeric,
  created_at timestamptz not null default now()
);

alter table outfit_generations add column if not exists stylist_brief text;

create table if not exists item_status_events (
  id uuid primary key default gen_random_uuid(),
  wardrobe_item_id uuid references wardrobe_items(id) on delete cascade,
  owner_id text not null default 'demo-user',
  status text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists day_briefs (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'demo-user',
  date date not null default current_date,
  calendar_summary text,
  weather_summary text,
  desired_vibe text,
  stylist_recommendation text,
  created_at timestamptz not null default now()
);

-- Saved stylist state so switching screens/reloading does not lose the day brief.
create table if not exists stylist_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'demo-user',
  profile_id uuid references wardrobe_profiles(id) on delete cascade,
  selected_date date not null default current_date,
  day_context text,
  weather_summary text,
  desired_vibe text,
  active_body_item_id uuid references wardrobe_items(id) on delete set null,
  draft_prompt text,
  last_recommendation jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One generated try-on per recommended Look A/B/C/D.
create table if not exists outfit_previews (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'demo-user',
  profile_id uuid references wardrobe_profiles(id) on delete cascade,
  stylist_session_id uuid references stylist_sessions(id) on delete cascade,
  look_label text not null,
  outfit_item_ids uuid[] not null,
  body_item_id uuid references wardrobe_items(id) on delete set null,
  prompt text,
  status text not null default 'queued',
  output_image_url text,
  output_base64 text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Saved Dress Me state so selections survive screens, reloads and profile switching until the next NZ day.
create table if not exists dress_me_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'demo-user',
  profile_id uuid references wardrobe_profiles(id) on delete cascade,
  selected_date date not null default current_date,
  body_item_id uuid references wardrobe_items(id) on delete set null,
  selected_item_ids uuid[] not null default '{}',
  occasion text,
  weather_summary text,
  notes text,
  last_output_data_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes.
create index if not exists wardrobe_profiles_owner_idx on wardrobe_profiles(owner_id);
create index if not exists wardrobe_items_owner_category_idx on wardrobe_items(owner_id, category);
create index if not exists wardrobe_items_laundry_idx on wardrobe_items(owner_id, laundry_status);
create index if not exists wardrobe_items_created_idx on wardrobe_items(created_at desc);
create index if not exists wardrobe_items_profile_archived_idx on wardrobe_items(profile_id, is_archived, category);
create index if not exists wardrobe_items_archived_idx on wardrobe_items(owner_id, is_archived, category);
create index if not exists wardrobe_items_canonical_idx on wardrobe_items(canonical_item_id);
create index if not exists wardrobe_item_photos_item_idx on wardrobe_item_photos(wardrobe_item_id, created_at);
create index if not exists stylist_sessions_profile_date_idx on stylist_sessions(profile_id, selected_date desc, updated_at desc);
create index if not exists outfit_previews_session_idx on outfit_previews(stylist_session_id, look_label);
create index if not exists dress_me_sessions_profile_date_idx on dress_me_sessions(profile_id, selected_date desc, updated_at desc);

-- Rename earlier seeded profiles if the previous pack already created them.
update wardrobe_profiles
set display_name = 'Manny',
    relationship = coalesce(relationship, 'self'),
    updated_at = now()
where owner_id = 'demo-user'
  and display_name = 'Manuel';

update wardrobe_profiles
set display_name = 'Yess',
    relationship = coalesce(relationship, 'wife'),
    updated_at = now()
where owner_id = 'demo-user'
  and display_name = 'Yessica';

-- Seed default profiles.
insert into wardrobe_profiles (owner_id, display_name, relationship, style_profile, is_active)
select 'demo-user', 'Manny', 'self',
'Modern executive, polished but not stiff corporate. Camera-friendly, Auckland-weather aware.',
true
where not exists (
  select 1 from wardrobe_profiles where owner_id = 'demo-user' and display_name = 'Manny'
);

insert into wardrobe_profiles (owner_id, display_name, relationship, style_profile, is_active)
select 'demo-user', 'Yess', 'wife',
'Smart, elegant, practical styling. Weather-aware, feminine, polished, not overly sporty.',
false
where not exists (
  select 1 from wardrobe_profiles where owner_id = 'demo-user' and display_name = 'Yess'
);

-- Existing uploads belong to Manny until reassigned manually later.
update wardrobe_items
set profile_id = (
  select id from wardrobe_profiles
  where owner_id = 'demo-user' and display_name = 'Manny'
  limit 1
)
where profile_id is null;

update wardrobe_items set is_archived = false where is_archived is null;
update wardrobe_items set angle_count = 1 where angle_count is null;
update wardrobe_items set image_role = 'primary' where image_role is null;

-- Backfill existing item photos into the new multi-angle photo table.
insert into wardrobe_item_photos (
  wardrobe_item_id,
  image_url,
  storage_path,
  source_item_id,
  angle_label,
  is_primary
)
select
  wi.id,
  wi.image_url,
  wi.storage_path,
  wi.id,
  coalesce(wi.image_role, 'primary'),
  true
from wardrobe_items wi
where wi.image_url is not null
  and not exists (
    select 1
    from wardrobe_item_photos p
    where p.source_item_id = wi.id
       or (
         p.wardrobe_item_id = wi.id
         and p.image_url = wi.image_url
       )
  );

-- Recalculate angle counts after backfill.
update wardrobe_items wi
set angle_count = greatest(1, coalesce(photo_counts.photo_count, 1))
from (
  select wardrobe_item_id, count(*)::integer as photo_count
  from wardrobe_item_photos
  group by wardrobe_item_id
) photo_counts
where wi.id = photo_counts.wardrobe_item_id;

-- Storage bucket: create this in Supabase Storage UI if you have not already:
-- bucket name: wardrobe
-- public: true for this local prototype. For production, make it private and use signed URLs.
