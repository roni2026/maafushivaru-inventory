-- ============================================================
-- 024_fifo_issuing_fixes.sql
--
-- issue_stock_requisition() now falls back to the item's own store_id when
-- the caller doesn't supply one (the website's Issuance page never has a
-- separate store picker -- it issues against the item's home store), and
-- store_id is made nullable so this can never hard-fail a valid issuance.
-- ============================================================

ALTER TABLE issuances ALTER COLUMN store_id DROP NOT NULL;
ALTER TABLE issuances ADD COLUMN IF NOT EXISTS note TEXT;

CREATE OR REPLACE FUNCTION issue_stock_requisition(
  p_item_id UUID,
  p_quantity NUMERIC,
  p_store_id UUID DEFAULT NULL,
  p_logged_by TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_date DATE DEFAULT NULL
) RETURNS issuances AS $$
DECLARE
  v_row issuances;
  v_store_id UUID;
BEGIN
  PERFORM _consume_batches_fifo(p_item_id, p_quantity);

  v_store_id := p_store_id;
  IF v_store_id IS NULL THEN
    SELECT store_id INTO v_store_id FROM items WHERE id = p_item_id;
  END IF;

  INSERT INTO issuances (item_id, quantity_issued, store_id, logged_by, note, date)
  VALUES (p_item_id, p_quantity, v_store_id, p_logged_by, p_note, COALESCE(p_date, CURRENT_DATE))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
