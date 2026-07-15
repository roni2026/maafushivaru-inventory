-- ============================================================
-- 026_boat_note_arrived_update_inventory.sql
--
-- Boat-note receiving is now a two-step workflow:
--
--   1. CONFIRM ARRIVAL  — mark each line as arrived / not_arrived /
--      wrong_item / damaged / short. Inventory is NOT touched yet.
--
--   2. UPDATE INVENTORY — posts only confirmed "arrived" (and the good
--      remainder of damaged/short) lines into Batch Expiry. Safe to press
--      more than once: lines already flagged posted_to_inventory are
--      skipped so quantity is never doubled.
--
-- Status vocabulary for boat_note_items:
--   pending     → not checked yet
--   arrived     → confirmed present, waiting for Update Inventory
--   received    → already posted into inventory
--   not_arrived → did not arrive
--   wrong_item  → wrong / unexpected item
--   damaged     → arrived damaged (good remainder may still post)
--   short       → short delivery (good remainder may still post)
--   skipped     → intentionally skipped / unmatched
--
-- Idempotent: safe to re-run.
-- ============================================================

-- ── 1. Allow 'arrived' on boat_note_items ────────────────────
ALTER TABLE boat_note_items DROP CONSTRAINT IF EXISTS boat_note_items_status_check;
ALTER TABLE boat_note_items
  ADD CONSTRAINT boat_note_items_status_check
  CHECK (status IN (
    'pending','arrived','received','skipped',
    'not_arrived','wrong_item','damaged','short'
  ));

-- Ensure the idempotency columns exist (added in 022, re-asserted here).
ALTER TABLE boat_note_items ADD COLUMN IF NOT EXISTS posted_to_inventory BOOLEAN DEFAULT FALSE;
ALTER TABLE boat_note_items ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_boat_note_items_posted
  ON boat_note_items(posted_to_inventory)
  WHERE posted_to_inventory IS NOT TRUE;

-- ── 2. update_boat_note_inventory (idempotent stock post) ────
-- Posts only lines that:
--   • are confirmed as arrived / damaged / short (good remainder)
--   • are NOT already posted_to_inventory
--   • have a matched item_id and qty > 0
-- Lines already posted are skipped — clicking twice never doubles stock.
CREATE OR REPLACE FUNCTION update_boat_note_inventory(
  p_boat_note_id UUID,
  p_actor TEXT DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  li RECORD;
  v_qty NUMERIC;
  v_batch item_batches;
  v_posted_now INT := 0;
  v_skipped_already INT := 0;
  v_problem_count INT := 0;
  v_pending_count INT := 0;
  v_total_count INT := 0;
  v_posted_total INT := 0;
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

    -- Problem lines stay on the note / Not Arrived view — never stocked.
    IF li.status IN ('not_arrived', 'wrong_item', 'skipped') THEN
      v_problem_count := v_problem_count + 1;
      CONTINUE;
    END IF;

    -- Already posted → never double-count.
    IF COALESCE(li.posted_to_inventory, FALSE) THEN
      v_skipped_already := v_skipped_already + 1;
      v_posted_total := v_posted_total + 1;
      CONTINUE;
    END IF;

    -- Only confirmed-arrived (or damaged/short with good remainder) post.
    -- Pure pending lines are left alone until the user confirms them.
    IF li.status NOT IN ('arrived', 'received', 'damaged', 'short') THEN
      v_pending_count := v_pending_count + 1;
      CONTINUE;
    END IF;

    -- Qty to add: received_qty if set, else ordered; subtract damaged/short.
    v_qty := COALESCE(li.received_qty, li.ordered_qty, 0);
    IF li.status = 'damaged' THEN
      v_qty := GREATEST(COALESCE(li.received_qty, COALESCE(li.ordered_qty, 0) - COALESCE(li.damaged_qty, 0)), 0);
    ELSIF li.status = 'short' THEN
      v_qty := GREATEST(COALESCE(li.received_qty, COALESCE(li.ordered_qty, 0) - COALESCE(li.short_qty, 0)), 0);
    END IF;
    v_qty := GREATEST(v_qty, 0);

    IF li.item_id IS NOT NULL AND v_qty > 0 THEN
      -- Reactivate item if it was inactive.
      UPDATE items SET active = TRUE WHERE id = li.item_id AND COALESCE(active, TRUE) = FALSE;

      INSERT INTO item_batches (item_id, expiry_date, quantity, remaining_quantity, batch_code, note)
      VALUES (
        li.item_id,
        li.expiry_date,
        v_qty,
        v_qty,
        li.part_number,
        'Boat note inventory update: ' || COALESCE(li.product_name, li.part_number, v_note_label)
      )
      RETURNING * INTO v_batch;

      BEGIN
        INSERT INTO stock_updates (item_id, date, quantity_change, new_quantity, updated_by, note)
        VALUES (
          li.item_id,
          (SELECT note_date FROM boat_notes WHERE id = p_boat_note_id),
          v_qty,
          NULL,
          p_actor,
          'Boat note inventory update · ' || v_note_label
        );
      EXCEPTION WHEN OTHERS THEN
        NULL; -- optional table / columns may differ
      END;

      BEGIN
        INSERT INTO receiving (
          item_id, item_name, date, quantity_received, unit,
          supplier_name, received_by, invoice_number, note
        )
        VALUES (
          li.item_id,
          COALESCE(li.product_name, li.part_number),
          (SELECT note_date FROM boat_notes WHERE id = p_boat_note_id),
          v_qty,
          li.unit,
          li.supplier,
          p_actor,
          li.po_number,
          'Boat note inventory update: ' || v_note_label
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;

      BEGIN
        INSERT INTO item_activity (item_id, action, detail, changed_by)
        VALUES (
          li.item_id,
          'received',
          'Inventory update · ' || v_qty::text || ' ' || COALESCE(li.unit, '') || ' · Boat note ' || v_note_label,
          p_actor
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;

      INSERT INTO boat_note_events (
        boat_note_id, boat_note_item_id, event_type, detail,
        part_number, product_name, department, qty, actor
      )
      VALUES (
        p_boat_note_id, li.id, 'inventory_updated',
        'Posted to inventory (idempotent update)',
        li.part_number, li.product_name, li.department, v_qty, p_actor
      );
    END IF;

    -- Mark line as posted + received so re-runs skip it.
    UPDATE boat_note_items
    SET posted_to_inventory = TRUE,
        posted_at = now(),
        status = CASE
          WHEN status IN ('damaged', 'short') THEN status  -- keep problem status
          ELSE 'received'
        END,
        received_qty = COALESCE(received_qty, v_qty),
        received_by = COALESCE(received_by, p_actor),
        received_at = COALESCE(received_at, now())
    WHERE id = li.id
      AND COALESCE(posted_to_inventory, FALSE) = FALSE;

    IF FOUND THEN
      v_posted_now := v_posted_now + 1;
      v_posted_total := v_posted_total + 1;
    ELSE
      v_skipped_already := v_skipped_already + 1;
      v_posted_total := v_posted_total + 1;
    END IF;
  END LOOP;

  -- Note-level status:
  --   delivered            → every non-problem line is posted
  --   partially_delivered  → some posted and some still pending/problem
  --   pending              → nothing posted yet
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
  VALUES (
    p_boat_note_id,
    'inventory_updated',
    'Update Inventory · posted ' || v_posted_now || ' new line(s), skipped ' ||
      v_skipped_already || ' already posted · status ' || v_new_status,
    p_actor
  );

  RETURN jsonb_build_object(
    'status', v_new_status,
    'posted_now', v_posted_now,
    'skipped_already', v_skipped_already,
    'posted_items', v_posted_total,
    'total_items', v_total_count,
    'problem_count', v_problem_count,
    'pending_count', v_pending_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. confirm_boat_note now ONLY confirms arrival (no stock) ─
-- Kept for backward compatibility with existing UI buttons. Marks
-- every still-pending line as arrived. Inventory is NOT updated —
-- call update_boat_note_inventory for that.
CREATE OR REPLACE FUNCTION confirm_boat_note(
  p_boat_note_id UUID,
  p_actor TEXT DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  li RECORD;
  v_arrived_now INT := 0;
  v_problem_count INT := 0;
  v_already INT := 0;
  v_total_count INT := 0;
  v_new_status TEXT;
BEGIN
  FOR li IN
    SELECT * FROM boat_note_items WHERE boat_note_id = p_boat_note_id
  LOOP
    v_total_count := v_total_count + 1;

    IF li.status IN ('not_arrived', 'wrong_item', 'skipped') THEN
      v_problem_count := v_problem_count + 1;
      CONTINUE;
    END IF;

    IF li.status IN ('arrived', 'received', 'damaged', 'short')
       OR COALESCE(li.posted_to_inventory, FALSE) THEN
      v_already := v_already + 1;
      CONTINUE;
    END IF;

    -- Confirm presence only — no batches, no stock.
    UPDATE boat_note_items
    SET status = 'arrived',
        received_qty = COALESCE(received_qty, ordered_qty),
        received_by = COALESCE(received_by, p_actor),
        received_at = COALESCE(received_at, now())
    WHERE id = li.id
      AND status = 'pending';

    IF FOUND THEN
      v_arrived_now := v_arrived_now + 1;
      INSERT INTO boat_note_events (
        boat_note_id, boat_note_item_id, event_type, detail,
        part_number, product_name, department, qty, actor
      )
      VALUES (
        p_boat_note_id, li.id, 'arrived',
        'Confirmed arrived (not yet in inventory)',
        li.part_number, li.product_name, li.department,
        COALESCE(li.received_qty, li.ordered_qty), p_actor
      );
    END IF;
  END LOOP;

  v_new_status := CASE
    WHEN v_total_count = 0 THEN 'pending'
    WHEN v_problem_count > 0 THEN 'partially_delivered'
    ELSE 'pending'  -- still waiting for Update Inventory
  END;

  UPDATE boat_notes
  SET status = CASE
        WHEN status IN ('delivered') THEN status
        WHEN v_problem_count > 0 AND (
          SELECT COUNT(*) FROM boat_note_items
          WHERE boat_note_id = p_boat_note_id
            AND COALESCE(posted_to_inventory, FALSE)
        ) > 0 THEN 'partially_delivered'
        ELSE status
      END,
      confirmed_at = COALESCE(confirmed_at, now()),
      confirmed_by = COALESCE(confirmed_by, p_actor),
      total_items = v_total_count,
      updated_at = now()
  WHERE id = p_boat_note_id;

  INSERT INTO boat_note_events (boat_note_id, event_type, detail, actor)
  VALUES (
    p_boat_note_id, 'note_updated',
    'Confirmed arrival for ' || v_arrived_now || ' line(s) · inventory not updated yet',
    p_actor
  );

  RETURN jsonb_build_object(
    'status', (SELECT status FROM boat_notes WHERE id = p_boat_note_id),
    'arrived_now', v_arrived_now,
    'already_confirmed', v_already,
    'problem_count', v_problem_count,
    'total_items', v_total_count,
    'posted_items', (
      SELECT COUNT(*) FROM boat_note_items
      WHERE boat_note_id = p_boat_note_id AND COALESCE(posted_to_inventory, FALSE)
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- pending_ordered_items: still exclude not-arrived / already-posted.
CREATE OR REPLACE VIEW pending_ordered_items AS
  SELECT
    bni.item_id,
    bni.part_number,
    bni.product_name,
    bn.id            AS boat_note_id,
    bn.note_number,
    bn.note_date     AS order_date,
    bn.expected_arrival,
    bn.status,
    SUM(bni.ordered_qty) AS ordered_quantity,
    MIN(bn.created_at)   AS pending_since
  FROM boat_note_items bni
  JOIN boat_notes bn ON bn.id = bni.boat_note_id
  WHERE bn.status IN ('pending','partially_delivered','draft','verified')
    AND bni.status NOT IN ('not_arrived','wrong_item','skipped')
    AND bni.posted_to_inventory IS NOT TRUE
  GROUP BY bni.item_id, bni.part_number, bni.product_name,
           bn.id, bn.note_number, bn.note_date, bn.expected_arrival, bn.status;
