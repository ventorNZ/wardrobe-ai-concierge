# Wardrobe AI MVP

A small Next.js + Supabase + OpenAI prototype for uploading wardrobe photos and generating AI outfit previews.

## What this does

- Uploads a body reference photo and wardrobe item photos to Supabase Storage.
- Stores clothing metadata in Supabase Postgres.
- Lets you select a body reference + wardrobe items.
- Calls the OpenAI Images edit endpoint with all selected images as references.
- Shows the generated try-on preview in the browser.

## Stack

- Next.js app router
- React + TypeScript
- Supabase Postgres
- Supabase Storage
- OpenAI Images API

## Setup

### 1. Create Supabase project

Create a new Supabase project. Then create a public storage bucket called:

```txt
wardrobe
```

For this quick MVP, public storage is simplest. For production, use private buckets and signed URLs.

### 2. Run database schema

Open Supabase SQL Editor and run:

```sql
-- copy/paste everything from supabase/schema.sql
```

### 3. Configure environment

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in:

```txt
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-2
```

### 4. Install and run

```bash
npm install
npm run dev
```

Open:

```txt
http://localhost:3000
```

## Best photo workflow

Body reference:

- Full body
- Front facing
- Neutral standing pose
- Good lighting
- Plain background if possible

Wardrobe items:

- One clothing item per photo
- Flat lay or hanger photo
- Avoid harsh shadows
- Photograph logos/details clearly

## Suggested product roadmap

### MVP 1 — Private wardrobe

- Upload body reference
- Upload clothes
- Generate outfit preview
- Store history

### MVP 2 — Outfit intelligence

- Auto-tag category, colour, season, and formality using a vision model
- Rate outfits by context: work, founders meeting, casual weekend, date night, travel
- Save favourites

### MVP 3 — Real user product

- Supabase Auth
- Private storage with signed URLs
- Outfit calendar
- Weather-aware outfit suggestions
- Cost tracking per generation
- Mobile app wrapper

### MVP 4 — Better try-on accuracy

- Body/garment segmentation
- Pose estimation
- Separate garment mask editing
- Front/back garment shots
- Fit feedback: too boxy, too long, too formal, wrong shoes, etc.

## Important note

This is a generative outfit preview, not a physics-accurate virtual fitting room. It is perfect for vibe, colour, silhouette, and styling direction. For exact sizing and garment physics, add segmentation and specialised virtual try-on models later.
Deploy trigger: Manny/Yess profile fix correctm corr
