-- Wardrobe AI v2 database schema / migration
-- Run this in Supabase SQL Editor. It is safe to run multiple times.

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

-- v2 enrichment columns for AI wardrobe ingestion
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

create index if not exists wardrobe_items_owner_category_idx on wardrobe_items(owner_id, category);
create index if not exists wardrobe_items_laundry_idx on wardrobe_items(owner_id, laundry_status);
create index if not exists wardrobe_items_created_idx on wardrobe_items(created_at desc);

-- Storage bucket: create this in Supabase Storage UI if you have not already:
-- bucket name: wardrobe
-- public: true for this local prototype. For production, make it private and use signed URLs.
