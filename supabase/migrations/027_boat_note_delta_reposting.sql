-- ============================================================
-- 027_boat_note_delta_reposting.sql
--
-- Makes "Update Inventory" post the DIFFERENCE instead of skipping a line
-- outright once it has been posted. Requested behaviour:
--
--   * Received 5 -> Update Inventory  -> 5 added.
--   * Click Update Inventory again    -> nothing added (no doubling).
--   * Edit received to 7 -> Update Inventory -> only the extra 2 is added.
--   * Edit received DOWN after posting -> stock is NOT auto-removed
--     (handle shrink manually in Batch Expiry), but posted_qty is remembered.
--
-- We track how many units of each line have already been posted in
-- boat_note_items.posted_qty and only ever post (target - posted_qty) when
-- that difference is positive. Fully idempotent & safe to re-run.
-- ============================================================

-- 1. Remember how much of each line is already in inventory.
ALTER TABLE boat_note_items ADD COLUMN IF NOT EXISTS posted_qty NUMERIC(12,2) DEFAULT 0;

-- Back-fill: lines already posted before this migration are assumed to have
-- posted their full received/ordered quantity.
UPDATE boat_note_items
SET posted_qty = COALESCE(received_qty, ordered_qty, 0)
WHERE COALESCE(posted_to_inventory, FALSE) = TRUE
  AND (posted_qty IS NULL OR posted_qty = 0);

-- 2. Delta-aware inventory posting.
CREATE OR REPLACE FUNCTION update_boat_note_inventory(
  p_boat_note_id UUID,
  p_actor TEXT DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  li RECORD;
  v_target NUMERIC;
  v_delta  NUMERIC;
  v_posted_now INT := 0;          -- lines that got new stock this run
  v_qty_posted_now NUMERIC := 0;  -- total units added this run
  v_skipped_already INT := 0;     -- lines with nothing new to post
  v_problem_count INT := 0;
  v_pending_count INT := 0;
  v_total_count INT := 0;
  v_posted_total INT := 0;        -- lines with any stock posted
  v_new_status TEXT;
  v_note_label TEXT;
BEGIN
  SELECT COALESCE(label, note_date::text, 'Boat note') INTO v_note_label
  FROM boat_notes WHERE id = p_boat_note_id;

  IF v_note_label IS NULL THEN
    RAISE EXCEPTION 'Boat note % not found', p_boat_note_id;
  END IF;

  FOR li IN
    SELECT * FROM boat_note_items
    WHERE boat_note_id = p_boat_note_id
    ORDER BY line_no NULLS LAST, created_at
  LOOP
    v_total_count := v_total_count + 1;

    -- Problem lines are never stocked.
    IF li.status IN ('not_arrived', 'wrong_item', 'skipped') THEN
      v_problem_count := v_problem_count + 1;
      CONTINUE;
    END IF;

    -- Only confirmed lines post. Pure pending lines wait for confirmation.
    IF li.status NOT IN ('arrived', 'received', 'damaged', 'short') THEN
      v_pending_count := v_pending_count + 1;
      CONTINUE;
    END IF;

    -- Target quantity that SHOULD be in inventory for this line.
    v_target := COALESCE(li.received_qty, li.ordered_qty, 0);
    IF li.status = 'damaged' THEN
      v_target := GREATEST(COALESCE(li.received_qty, COALESCE(li.ordered_qty, 0) - COALESCE(li.damaged_qty, 0)), 0);
    ELSIF li.status = 'short' THEN
      v_target := GREATEST(COALESCE(li.received_qty, COALESCE(li.ordered_qty, 0) - COALESCE(li.short_qty, 0)), 0);
    END IF;
    v_target := GREATEST(v_target, 0);

    -- Only the not-yet-posted remainder is added.
    v_delta := v_target - COALESCE(li.posted_qty, 0);

    IF li.item_id IS NOT NULL AND v_delta > 0 THEN
      UPDATE items SET active = TRUE WHERE id = li.item_id AND COALESCE(active, TRUE) = FALSE;

      INSERT INTO item_batches (item_id, expiry_date, quantity, remaining_quantity, batch_code, note)
      VALUES (
        li.item_id, li.expiry_date, v_delta, v_delta, li.part_number,
        'Boat note inventory update: ' || COALESCE(li.product_name, li.part_number, v_note_label)
      );

      BEGIN
        INSERT INTO stock_updates (item_id, date, quantity_change, new_quantity, updated_by, note)
        VALUES (li.item_id, (SELECT note_date FROM boat_notes WHERE id = p_boat_note_id),
                v_delta, NULL, p_actor, 'Boat note inventory update · ' || v_note_label);
      EXCEPTION WHEN OTHERS THEN NULL; END;

      BEGIN
        INSERT INTO receiving (item_id, item_name, date, quantity_received, unit,
                               supplier_name, received_by, invoice_number, note)
        VALUES (li.item_id, COALESCE(li.product_name, li.part_number),
                (SELECT note_date FROM boat_notes WHERE id = p_boat_note_id),
                v_delta, li.unit, li.supplier, p_actor, li.po_number,
                'Boat note inventory update: ' || v_note_label);
      EXCEPTION WHEN OTHERS THEN NULL; END;

      BEGIN
        INSERT INTO item_activity (item_id, action, detail, changed_by)
        VALUES (li.item_id, 'received',
                'Inventory update · +' || v_delta::text || ' ' || COALESCE(li.unit, '') ||
                ' (total ' || v_target::text || ') · Boat note ' || v_note_label, p_actor);
      EXCEPTION WHEN OTHERS THEN NULL; END;

      INSERT INTO boat_note_events (boat_note_id, boat_note_item_id, event_type, detail,
                                    part_number, product_name, department, qty, actor)
      VALUES (p_boat_note_id, li.id, 'inventory_updated',
              'Posted +' || v_delta::text || ' (target ' || v_target::text || ', was ' || COALESCE(li.posted_qty,0)::text || ')',
              li.part_number, li.product_name, li.department, v_delta, p_actor);

      UPDATE boat_note_items
      SET posted_qty = v_target,
          posted_to_inventory = TRUE,
          posted_at = now(),
          status = CASE WHEN status IN ('damaged','short') THEN status ELSE 'received' END,
          received_qty = COALESCE(received_qty, v_target),
          received_by = COALESCE(received_by, p_actor),
          received_at = COALESCE(received_at, now())
      WHERE id = li.id;

      v_posted_now := v_posted_now + 1;
      v_qty_posted_now := v_qty_posted_now + v_delta;
      v_posted_total := v_posted_total + 1;
    ELSE
      -- Nothing new to add (delta <= 0). Keep it flagged as posted if it has qty.
      IF COALESCE(li.posted_qty, 0) > 0 OR COALESCE(li.posted_to_inventory, FALSE) THEN
        v_skipped_already := v_skipped_already + 1;
        v_posted_total := v_posted_total + 1;
        -- Ensure posted flag/qty are consistent for zero-delta confirmed lines.
        UPDATE boat_note_items
        SET posted_to_inventory = TRUE,
            posted_qty = GREATEST(COALESCE(posted_qty,0), v_target),
            status = CASE WHEN status IN ('damaged','short') THEN status ELSE 'received' END
        WHERE id = li.id AND COALESCE(posted_to_inventory, FALSE) = FALSE;
      ELSE
        -- Confirmed but no matched item / zero qty -> treat as pending-ish.
        v_pending_count := v_pending_count + 1;
      END IF;
    END IF;
  END LOOP;

  v_new_status := CASE
    WHEN v_total_count = 0 THEN 'delivered'
    WHEN v_posted_total = 0 AND v_problem_count = 0 THEN 'pending'
    WHEN v_posted_total + v_problem_count >= v_total_count AND v_pending_count = 0 THEN
      CASE WHEN v_problem_count > 0 THEN 'partially_delivered' ELSE 'delivered' END
    WHEN v_posted_total > 0 THEN 'partially_delivered'
    ELSE 'pending'
  END;

  UPDATE boat_notes
  SET status = v_new_status,
      confirmed_at = COALESCE(confirmed_at, now()),
      confirmed_by = COALESCE(confirmed_by, p_actor),
      posted_items = v_posted_total,
      total_items = v_total_count,
      updated_at = now()
  WHERE id = p_boat_note_id;

  INSERT INTO boat_note_events (boat_note_id, event_type, detail, actor)
  VALUES (p_boat_note_id, 'inventory_updated',
          'Update Inventory · +' || v_qty_posted_now::text || ' unit(s) across ' || v_posted_now ||
          ' line(s), ' || v_skipped_already || ' already up to date · status ' || v_new_status, p_actor);

  RETURN jsonb_build_object(
    'status', v_new_status,
    'posted_now', v_posted_now,
    'qty_posted_now', v_qty_posted_now,
    'skipped_already', v_skipped_already,
    'posted_items', v_posted_total,
    'total_items', v_total_count,
    'problem_count', v_problem_count,
    'pending_count', v_pending_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
