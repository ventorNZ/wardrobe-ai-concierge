# Wardrobe AI Concierge consolidated fix

This pack replaces the earlier multi-angle-only fix. It adds:

- Manny/Yess profile separation
- multi-angle wardrobe item support
- duplicate merge/archive flow in Wardrobe
- per-look try-on generation from the Stylist page
- no fake “On you” preview using the raw body photo
- voice input for stylist/day brief and Dress Me notes
- blank stylist prompt fields with placeholders instead of forced samples
- live weather by browser location and selected date, reported in NZ time
- saved Stylist and Dress Me sessions across screens/reloads/profile switching
- daily reset based on the New Zealand calendar day, not UTC

## 1. Run Supabase migration first

Open Supabase SQL Editor and run the full contents of:

```bash
supabase/schema.sql
```

This is safe to run more than once. It creates/updates:

- `wardrobe_profiles`
- `wardrobe_item_photos`
- profile/archive/canonical columns on `wardrobe_items`
- `stylist_sessions`
- `dress_me_sessions`
- `outfit_previews`
- default Manny and Yess profiles, stored in `wardrobe_profiles.display_name`
- backfills existing rows/photos into Manny and `wardrobe_item_photos`

The existing Supabase bucket is still:

```text
wardrobe
```

Keep it public for this prototype unless you later implement signed URLs.

## 2. Apply locally

```bash
cd ~/Downloads
unzip wardrobe-ai-concierge-profiles-voice-weather-tryon-fix.zip

rsync -av \
  --exclude='.git' \
  --exclude='.env.local' \
  --exclude='.vercel' \
  --exclude='node_modules' \
  --exclude='.next' \
  wardrobe-ai-concierge/ ~/Desktop/wardrobe-ai-concierge/

cd ~/Desktop/wardrobe-ai-concierge
npm install
npm run build
```

## 3. Commit and deploy

```bash
git status
git add .
git commit -m "Add profiles voice weather sessions and per-outfit try-on previews"
git push origin main
npx vercel@latest --prod
```

## 4. Test in this order

1. Open the deployed app.
2. Confirm the top navigation shows a Profile selector.
3. Confirm profiles show Manny and Yess.
4. Open Wardrobe under Manny and confirm existing items appear.
5. Switch to Yess and confirm Manny's wardrobe does not appear.
6. Open Stylist.
7. Confirm fields are blank placeholders, not forced sample text.
8. Tap live NZ-time weather and allow location; confirm it shows the current NZ hour plus the day forecast.
9. Ask for recommendations.
10. Confirm Look A/B show placeholders, not your raw body reference photo.
11. Generate Look A on me.
12. Generate Look B on me.
13. Confirm Look A and Look B produce separate generated try-on previews.
14. Leave Stylist, return, switch profiles, switch back, and confirm today’s session survives. It should reset only when the NZ date changes.
15. Open Wardrobe and merge duplicate shoe photos into one canonical item.
16. Confirm duplicates disappear and the canonical item shows an angle count.
17. Open Dress Me and confirm archived duplicates are hidden. Select items, leave the page, return, and confirm the Dress Me selection is restored for the same profile/day.

## 5. Upload behaviour

Do not upload another huge batch yet.

Current safe behaviour:

- max batch: 10–15 photos
- stay on Upload while it runs
- Upload queue is only the current screen queue
- Wardrobe/database is the source of truth

## 6. Notes

The image generation route now uses multi-angle photos automatically by reading `wardrobe_item_photos`. Each clothing item can contribute up to two photo references so the generator understands front/side/detail angles without treating them as separate wardrobe items.

The Stylist page no longer displays the body reference image in the preview area. It shows a placeholder until a specific look is generated.


## 7. Persistence and NZ time rules

- Profile display names are stored in Supabase, not hardcoded only in the UI: `Manny` and `Yess`.
- Stylist state is saved by `profile_id + selected_date` in `stylist_sessions`.
- Dress Me state is saved by `profile_id + selected_date` in `dress_me_sessions`.
- The app calculates today using `Pacific/Auckland`, so it does not roll over at UTC midnight.
- When the NZ day changes, the default daily session moves to the new date. Previous days remain in the DB for history.
- Live weather uses the browser location but requests the forecast using `Pacific/Auckland` timezone and writes the current NZ hour into the weather brief.
