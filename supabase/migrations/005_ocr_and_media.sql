-- ============================================================
-- 005_ocr_and_media.sql
-- Add image_url and location to items table
-- ============================================================

ALTER TABLE items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS location  TEXT;

-- ── Supabase Storage Setup ─────────────────────────────────
-- Run these in Supabase Dashboard → Storage → New Bucket
-- OR execute via the SQL editor:

-- Create the item-images storage bucket (public)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'item-images',
  'item-images',
  true,
  5242880,  -- 5MB limit per image
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
) ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload images
CREATE POLICY "auth_upload_item_images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'item-images');

-- Allow authenticated users to update/replace images
CREATE POLICY "auth_update_item_images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'item-images');

-- Allow authenticated users to delete images
CREATE POLICY "auth_delete_item_images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'item-images');

-- Allow public read of images (so images display in the app)
CREATE POLICY "public_read_item_images"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'item-images');
