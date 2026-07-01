-- ============================================================
-- 017_media_activity_and_outcomes.sql
--
-- Adds three capabilities requested for both the web app and the mobile app:
--
--   1. MULTI-IMAGE support per inventory item (max 3, enforced in-app) stored in
--      Supabase Storage. A new `item_images` table keeps one row per photo while
--      `items.image_url` continues to hold the primary/first photo for backward
--      compatibility with existing screens.
--
--   2. ITEM ACTIVITY LOG  — a per-item audit trail so every screen can show
--      "last updated <when> by <who>" and a "view more" list of the last 15
--      changes (edits, sub-category moves, photo add/remove, stock adjustments).
--
--   3. BOAT-NOTE OUTCOMES — the receiving workflow can now flag a line as
--      `damaged` in addition to received / not_arrived / wrong_item, and every
--      posted line is preserved so a "Received" view can list them distinctly.
--
-- Every statement is idempotent (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS) so
-- the file is safe to run against a live database that already has 001-016.
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Track who last edited an item (date/time is already `items.updated_at`).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE items ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Multiple photos per item (max 3 enforced in the apps).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_images (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,             -- public URL (with cache-buster)
  storage_path TEXT,                      -- path inside the item-images bucket
  position     INT  NOT NULL DEFAULT 0,   -- 0 = primary photo
  size_bytes   INT,                       -- final (compressed) size, for reference
  created_by   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_item_images_item ON item_images(item_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Per-item activity / audit log.
--    action examples: 'created','edited','subcategory_changed','stock_add',
--                     'stock_remove','stock_set','photo_added','photo_removed',
--                     'received','deactivated','activated'
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_activity (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  detail      TEXT,               -- human-readable summary of what changed
  changed_by  TEXT,               -- user/admin email or name
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_item_activity_item ON item_activity(item_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Boat-note line outcomes: add `damaged`.
--    pending    → not confirmed yet ("nothing" set)
--    received   → confirmed & posted to inventory (moves to the Received view)
--    damaged    → arrived damaged
--    wrong_item → wrong / unexpected item delivered
--    not_arrived→ was on the note but did not arrive
--    skipped    → intentionally not received
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE boat_note_items DROP CONSTRAINT IF EXISTS boat_note_items_status_check;
ALTER TABLE boat_note_items
  ADD CONSTRAINT boat_note_items_status_check
  CHECK (status IN ('pending','received','skipped','not_arrived','wrong_item','damaged'));

-- Record who confirmed the line and when (for the Received view + reports).
ALTER TABLE boat_note_items ADD COLUMN IF NOT EXISTS received_by TEXT;
ALTER TABLE boat_note_items ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Storage: reuse the existing public `item-images` bucket (created in 005).
--    Re-assert it here so a fresh database still gets it. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'item-images','item-images', true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
) ON CONFLICT (id) DO NOTHING;
