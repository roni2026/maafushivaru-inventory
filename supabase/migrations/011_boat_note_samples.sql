-- ────────────────────────────────────────────────────────────────────────────
-- 011_boat_note_samples.sql
--
-- SAMPLE tracking for boat notes. When the word "sample" appears in a boat-note
-- line's item code (part number), that line is a SAMPLE that arrived with the
-- delivery. We flag those rows so every sample received over time can be tracked
-- on the Boat Note → Samples tab.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) so it is safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE boat_note_items ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT FALSE;

-- Backfill existing rows: any line whose part number / PO / product mentions "sample".
UPDATE boat_note_items
   SET is_sample = TRUE
 WHERE is_sample IS DISTINCT FROM TRUE
   AND (part_number  ILIKE '%sample%'
     OR po_number    ILIKE '%sample%'
     OR product_name ILIKE '%sample%');

-- Fast lookup for the Samples tab.
CREATE INDEX IF NOT EXISTS idx_boat_note_items_sample ON boat_note_items(is_sample) WHERE is_sample = TRUE;
