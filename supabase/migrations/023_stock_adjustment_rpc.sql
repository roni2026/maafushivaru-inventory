-- ============================================================
-- 023_stock_adjustment_rpc.sql
--
-- Closes the last gap where inventory could still be changed WITHOUT going
-- through the Batch Expiry system: the "Update Stock" quick-adjust modal
-- (Set / Add / Subtract) on the website and the equivalent on Android.
--
-- Both now call adjust_item_stock() instead of writing items.current_stock
-- directly, so stock manually added always lands in a batch (a no-expiry
-- "adjustment" batch is reused/created) and stock manually removed is
-- consumed FIFO from existing batches -- current_stock is still always
-- SUM(remaining_quantity), with zero exceptions anywhere in the app.
-- ============================================================

CREATE OR REPLACE FUNCTION adjust_item_stock(
  p_item_id UUID,
  p_delta NUMERIC,
  p_note TEXT DEFAULT NULL,
  p_updated_by TEXT DEFAULT NULL
) RETURNS NUMERIC AS $$
DECLARE
  v_adj_batch_id UUID;
  v_new_stock NUMERIC;
BEGIN
  IF p_delta IS NULL OR p_delta = 0 THEN
    SELECT current_stock INTO v_new_stock FROM items WHERE id = p_item_id;
    RETURN v_new_stock;
  END IF;

  IF p_delta > 0 THEN
    -- Reuse an existing open-ended (no expiry) adjustment batch for this
    -- item if one exists, otherwise create one. Keeps the batch list tidy
    -- instead of spawning a new row for every small correction.
    SELECT id INTO v_adj_batch_id
    FROM item_batches
    WHERE item_id = p_item_id AND expiry_date IS NULL AND note = 'Manual stock adjustment (no expiry)'
    ORDER BY created_at DESC LIMIT 1;

    IF v_adj_batch_id IS NULL THEN
      INSERT INTO item_batches (item_id, expiry_date, quantity, remaining_quantity, note)
      VALUES (p_item_id, NULL, p_delta, p_delta, 'Manual stock adjustment (no expiry)');
    ELSE
      UPDATE item_batches
      SET quantity = quantity + p_delta,
          remaining_quantity = remaining_quantity + p_delta,
          updated_at = now()
      WHERE id = v_adj_batch_id;
    END IF;
  ELSE
    PERFORM _consume_batches_fifo(p_item_id, ABS(p_delta));
  END IF;

  SELECT current_stock INTO v_new_stock FROM items WHERE id = p_item_id;

  INSERT INTO stock_updates (item_id, quantity_change, new_quantity, updated_by, note)
  VALUES (p_item_id, p_delta, v_new_stock, p_updated_by, COALESCE(p_note, 'Manual stock adjustment'));

  RETURN v_new_stock;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
