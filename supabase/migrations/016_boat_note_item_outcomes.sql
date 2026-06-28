-- ============================================================
-- 016_boat_note_item_outcomes.sql
-- Boat-note lines can now record a delivery problem so the team can track
-- what to follow up on:
--   not_arrived  → the item was on the note but did not arrive
--   wrong_item   → a wrong / unexpected item was delivered
-- The existing free-text `note` column holds the explanation.
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE boat_note_items DROP CONSTRAINT IF EXISTS boat_note_items_status_check;

ALTER TABLE boat_note_items
  ADD CONSTRAINT boat_note_items_status_check
  CHECK (status IN ('pending','received','skipped','not_arrived','wrong_item'));

CREATE INDEX IF NOT EXISTS idx_boat_note_items_status ON boat_note_items(status);
