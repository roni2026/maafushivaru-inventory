-- ============================================================
-- 022_unified_batch_expiry.sql
--
-- ONE EXPIRY SYSTEM: "Batch Expiry"
--
-- Removes the split-brain between:
--   (a) the original single `items.expiry_date` field, and
--   (b) the Android-only "batch expiry" concept (`item_batches`)
--
-- From this migration onward there is exactly ONE table that is the
-- source of truth for both stock quantity AND expiry:
--
--     item_batches   (id, item_id, expiry_date, quantity,
--                      remaining_quantity, batch_code, note,
--                      created_at, updated_at)
--
-- A read-only view named `inventory_batches` is provided as an alias so the
-- table can be referenced under the name suggested in the spec without
-- breaking any existing code that already talks to `item_batches`.
--
-- Golden rule enforced by a trigger (both apps, same DB, same result):
--     items.current_stock == SUM(item_batches.remaining_quantity)
--
-- Adding/editing/deleting a batch NEVER manually bumps items.current_stock
-- from client code anymore -- the DB recalculates it automatically.
--
-- FIFO issuing, batch CRUD and boat-note confirmation are exposed as
-- Postgres RPC functions so the website and the Android app call the exact
-- same business logic and always produce identical results.
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. item_batches: add remaining_quantity (the live, issuable qty)
-- ------------------------------------------------------------
ALTER TABLE item_batches ADD COLUMN IF NOT EXISTS remaining_quantity NUMERIC(10,2);

UPDATE item_batches SET remaining_quantity = quantity WHERE remaining_quantity IS NULL;

ALTER TABLE item_batches ALTER COLUMN remaining_quantity SET DEFAULT 0;
ALTER TABLE item_batches ALTER COLUMN remaining_quantity SET NOT NULL;

-- Guarded so this migration can be safely re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'item_batches_remaining_nonneg'
  ) THEN
    ALTER TABLE item_batches ADD CONSTRAINT item_batches_remaining_nonneg
      CHECK (remaining_quantity >= 0);
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_item_batches_remaining ON item_batches(remaining_quantity);

-- ------------------------------------------------------------
-- 2. MIGRATE legacy data into the batch system (no data loss)
--
--    a) Items that still only have a legacy `items.expiry_date` and/or
--       `items.current_stock` but NO batch rows yet get exactly one
--       migrated batch created so the batch list becomes the source of
--       truth immediately, with the existing stock preserved.
-- ------------------------------------------------------------
INSERT INTO item_batches (item_id, expiry_date, quantity, remaining_quantity, note)
SELECT i.id, i.expiry_date, i.current_stock, i.current_stock,
       'Migrated automatically from legacy single-expiry field'
FROM items i
WHERE COALESCE(i.current_stock, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM item_batches b WHERE b.item_id = i.id);

-- ------------------------------------------------------------
-- 3. Compatibility view using the name suggested in the spec.
--    Read from either name -- both point at the same rows.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW inventory_batches AS
  SELECT
    id,
    item_id AS inventory_id,
    expiry_date,
    quantity,
    remaining_quantity,
    batch_code,
    note,
    created_at,
    updated_at
  FROM item_batches;

-- ------------------------------------------------------------
-- 4. Auto-sync trigger: items.current_stock = SUM(remaining_quantity)
--    Fires on every insert / update / delete of a batch so BOTH apps,
--    using nothing more than the shared `item_batches` table, always see
--    a consistent inventory quantity. This is what fixes the
--    "50 + 60 = 110" bug -- inventory is never incremented by hand again,
--    it is always *recomputed* from the batches that currently exist.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalc_item_stock(p_item_id UUID) RETURNS VOID AS $$
BEGIN
  UPDATE items
  SET current_stock = (
        SELECT COALESCE(SUM(remaining_quantity), 0)
        FROM item_batches
        WHERE item_id = p_item_id
      ),
      updated_at = now()
  WHERE id = p_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION trg_item_batches_sync() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalc_item_stock(OLD.item_id);
    RETURN OLD;
  END IF;

  PERFORM recalc_item_stock(NEW.item_id);

  IF TG_OP = 'UPDATE' AND OLD.item_id IS DISTINCT FROM NEW.item_id THEN
    PERFORM recalc_item_stock(OLD.item_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS item_batches_sync_stock ON item_batches;
CREATE TRIGGER item_batches_sync_stock
  AFTER INSERT OR UPDATE OR DELETE ON item_batches
  FOR EACH ROW EXECUTE FUNCTION trg_item_batches_sync();

-- Run once now so every item's current_stock matches reality immediately.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT item_id FROM item_batches LOOP
    PERFORM recalc_item_stock(r.item_id);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 5. Batch CRUD RPCs -- identical logic for Website + Android.
--    `upsert_item_batch` handles BOTH create (p_batch_id NULL) and edit.
--    When editing an existing batch's `quantity`, only the *delta* is
--    applied to remaining_quantity so any already-issued portion of the
--    batch is respected (never resurrects consumed stock, never loses it).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_item_batch(
  p_batch_id   UUID,
  p_item_id    UUID,
  p_expiry_date DATE,
  p_quantity   NUMERIC,
  p_batch_code TEXT DEFAULT NULL,
  p_note       TEXT DEFAULT NULL
) RETURNS item_batches AS $$
DECLARE
  v_row item_batches;
  v_old_qty NUMERIC;
  v_old_remaining NUMERIC;
  v_delta NUMERIC;
  v_new_remaining NUMERIC;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'Batch quantity must be zero or greater';
  END IF;

  IF p_batch_id IS NULL THEN
    INSERT INTO item_batches (item_id, expiry_date, quantity, remaining_quantity, batch_code, note)
    VALUES (p_item_id, p_expiry_date, p_quantity, p_quantity, p_batch_code, p_note)
    RETURNING * INTO v_row;
  ELSE
    SELECT quantity, remaining_quantity INTO v_old_qty, v_old_remaining
    FROM item_batches WHERE id = p_batch_id FOR UPDATE;

    IF v_old_qty IS NULL THEN
      RAISE EXCEPTION 'Batch % not found', p_batch_id;
    END IF;

    v_delta := p_quantity - v_old_qty;
    v_new_remaining := GREATEST(v_old_remaining + v_delta, 0);

    UPDATE item_batches
    SET quantity = p_quantity,
        remaining_quantity = v_new_remaining,
        expiry_date = p_expiry_date,
        batch_code = COALESCE(p_batch_code, batch_code),
        note = COALESCE(p_note, note),
        updated_at = now()
    WHERE id = p_batch_id
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION delete_item_batch(p_batch_id UUID) RETURNS VOID AS $$
BEGIN
  DELETE FROM item_batches WHERE id = p_batch_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 6. FIFO issuing -- oldest expiry first, then oldest created_at
--    (batches with no expiry date are treated as "last to issue").
--    One shared internal consumer used by BOTH issue paths so the
--    numbers can never diverge between Website and Android:
--       issue_stock_requisition(...)  -> writes to `issuances`
--       issue_stock_manual(...)       -> writes to `manual_issues`
--                                         (this is "Issue Without Req")
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION _consume_batches_fifo(p_item_id UUID, p_quantity NUMERIC)
RETURNS VOID AS $$
DECLARE
  v_remaining_to_issue NUMERIC := p_quantity;
  v_available NUMERIC;
  b RECORD;
  v_take NUMERIC;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Issue quantity must be greater than zero';
  END IF;

  SELECT COALESCE(SUM(remaining_quantity), 0) INTO v_available
  FROM item_batches WHERE item_id = p_item_id;

  IF v_available < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock: only % remaining across batches, requested %', v_available, p_quantity;
  END IF;

  FOR b IN
    SELECT id, remaining_quantity
    FROM item_batches
    WHERE item_id = p_item_id AND remaining_quantity > 0
    ORDER BY expiry_date ASC NULLS LAST, created_at ASC
    FOR UPDATE
  LOOP
    IF v_remaining_to_issue <= 0 THEN EXIT; END IF;
    v_take := LEAST(b.remaining_quantity, v_remaining_to_issue);
    UPDATE item_batches SET remaining_quantity = remaining_quantity - v_take, updated_at = now()
      WHERE id = b.id;
    v_remaining_to_issue := v_remaining_to_issue - v_take;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION issue_stock_requisition(
  p_item_id UUID,
  p_quantity NUMERIC,
  p_store_id UUID,
  p_logged_by TEXT DEFAULT NULL
) RETURNS issuances AS $$
DECLARE v_row issuances;
BEGIN
  PERFORM _consume_batches_fifo(p_item_id, p_quantity);

  INSERT INTO issuances (item_id, quantity_issued, store_id, logged_by)
  VALUES (p_item_id, p_quantity, p_store_id, p_logged_by)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION issue_stock_manual(
  p_item_id UUID,
  p_item_name TEXT,
  p_part_number TEXT,
  p_quantity NUMERIC,
  p_unit TEXT,
  p_destination_location TEXT,
  p_issued_to TEXT,
  p_issued_by TEXT,
  p_batch_group_id UUID DEFAULT NULL,
  p_kitchen TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_deduct_stock BOOLEAN DEFAULT TRUE
) RETURNS manual_issues AS $$
DECLARE v_row manual_issues;
BEGIN
  IF p_deduct_stock AND p_item_id IS NOT NULL THEN
    PERFORM _consume_batches_fifo(p_item_id, p_quantity);
  END IF;

  INSERT INTO manual_issues (
    item_id, item_name, part_number, quantity, unit,
    destination_location, issued_to, issued_by, batch_id, kitchen, note, deduct_stock
  ) VALUES (
    p_item_id, p_item_name, p_part_number, p_quantity, p_unit,
    p_destination_location, p_issued_to, p_issued_by, p_batch_group_id, p_kitchen, p_note, p_deduct_stock
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 7. Boat Note workflow: Weekly Order -> Boat Note Created ->
--    Waiting for Delivery -> Items Arrive -> Confirm Delivery ->
--    Inventory Updated.
--
--    Extend status vocabulary (kept backward compatible with the old
--    'draft' / 'verified' / 'posted' values already used by existing
--    boat notes) and track exactly which lines have already been
--    posted into inventory so confirm_boat_note() can be called safely
--    more than once (idempotent).
-- ------------------------------------------------------------
ALTER TABLE boat_notes DROP CONSTRAINT IF EXISTS boat_notes_status_check;
ALTER TABLE boat_notes ADD CONSTRAINT boat_notes_status_check
  CHECK (status IN ('draft','verified','posted','pending','partially_delivered','delivered','cancelled'));

ALTER TABLE boat_notes ADD COLUMN IF NOT EXISTS note_number TEXT;
ALTER TABLE boat_notes ADD COLUMN IF NOT EXISTS expected_arrival DATE;
ALTER TABLE boat_notes ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE boat_notes ADD COLUMN IF NOT EXISTS confirmed_by TEXT;

UPDATE boat_notes SET note_number = 'BN-' || to_char(note_date, 'YYYYMMDD') || '-' || substr(id::text, 1, 6)
  WHERE note_number IS NULL;

-- Map legacy statuses to the new "pending delivery" vocabulary so old boat
-- notes surface correctly in the new Pending / Delivered / Partially
-- Delivered / Cancelled dashboard filters without losing history.
UPDATE boat_notes SET status = 'pending' WHERE status = 'draft';
UPDATE boat_notes SET status = 'delivered' WHERE status = 'posted';

ALTER TABLE boat_note_items ADD COLUMN IF NOT EXISTS posted_to_inventory BOOLEAN DEFAULT FALSE;
ALTER TABLE boat_note_items ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_boat_notes_status ON boat_notes(status);

CREATE OR REPLACE FUNCTION confirm_boat_note(p_boat_note_id UUID, p_actor TEXT DEFAULT NULL)
RETURNS jsonb AS $$
DECLARE
  li RECORD;
  v_qty NUMERIC;
  v_batch item_batches;
  v_posted_count INT := 0;
  v_problem_count INT := 0;
  v_total_count INT := 0;
  v_new_status TEXT;
BEGIN
  FOR li IN
    SELECT * FROM boat_note_items WHERE boat_note_id = p_boat_note_id
  LOOP
    v_total_count := v_total_count + 1;

    IF li.status IN ('not_arrived','wrong_item') THEN
      v_problem_count := v_problem_count + 1;
      CONTINUE;
    END IF;

    IF li.posted_to_inventory THEN
      v_posted_count := v_posted_count + 1;
      CONTINUE;
    END IF;

    v_qty := COALESCE(li.received_qty, li.ordered_qty, 0);
    IF li.status = 'damaged' THEN v_qty := v_qty - COALESCE(li.damaged_qty, 0); END IF;
    IF li.status = 'short'   THEN v_qty := v_qty - COALESCE(li.short_qty, 0);   END IF;
    v_qty := GREATEST(v_qty, 0);

    IF li.item_id IS NOT NULL AND v_qty > 0 THEN
      INSERT INTO item_batches (item_id, expiry_date, quantity, remaining_quantity, batch_code, note)
      VALUES (li.item_id, li.expiry_date, v_qty, v_qty,
              li.part_number, 'Boat note delivery: ' || COALESCE(li.product_name, li.part_number, ''))
      RETURNING * INTO v_batch;

      INSERT INTO boat_note_events (boat_note_id, boat_note_item_id, event_type, detail, part_number, product_name, department, qty, actor)
      VALUES (p_boat_note_id, li.id, 'confirmed', 'Confirmed delivery, added to inventory batch', li.part_number, li.product_name, li.department, v_qty, p_actor);
    END IF;

    UPDATE boat_note_items SET posted_to_inventory = TRUE, posted_at = now(), status = 'received'
      WHERE id = li.id;

    v_posted_count := v_posted_count + 1;
  END LOOP;

  v_new_status := CASE
    WHEN v_total_count = 0 THEN 'delivered'
    WHEN v_problem_count = 0 THEN 'delivered'
    WHEN v_posted_count > 0 THEN 'partially_delivered'
    ELSE 'partially_delivered'
  END;

  UPDATE boat_notes
  SET status = v_new_status,
      confirmed_at = now(),
      confirmed_by = p_actor,
      posted_items = v_posted_count,
      total_items = v_total_count,
      updated_at = now()
  WHERE id = p_boat_note_id;

  INSERT INTO boat_note_events (boat_note_id, event_type, detail, actor)
  VALUES (p_boat_note_id, 'note_updated', 'Boat note confirmed -- inventory updated (' || v_new_status || ')', p_actor);

  RETURN jsonb_build_object('status', v_new_status, 'posted_items', v_posted_count, 'total_items', v_total_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Which items are already on an un-delivered boat note right now?
-- Used by Website + Android ordering screens to show "Already Ordered".
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
  WHERE bn.status IN ('pending','partially_delivered')
    AND bni.status NOT IN ('not_arrived','wrong_item')
    AND bni.posted_to_inventory IS NOT TRUE
  GROUP BY bni.item_id, bni.part_number, bni.product_name, bn.id, bn.note_number, bn.note_date, bn.expected_arrival, bn.status;

-- ------------------------------------------------------------
-- 8. Notifications -- persisted, shared, fired individually.
--    Fixes: "13 notifications at once", missed schedule time, duplicates.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT NOT NULL,              -- 'low_stock' | 'out_of_stock' | 'expiring' | 'expired' | 'boat_note_pending'
  severity     TEXT NOT NULL DEFAULT 'medium',
  dedupe_key   TEXT NOT NULL,              -- unique per (type, subject) while the condition remains active
  item_id      UUID REFERENCES items(id) ON DELETE CASCADE,
  ref_table    TEXT,
  ref_id       UUID,
  title        TEXT NOT NULL,
  body         TEXT,
  link         TEXT,
  notify_at    TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when it should actually be delivered
  sent_at      TIMESTAMPTZ,                          -- NULL until delivered to a client (once)
  resolved_at  TIMESTAMPTZ,                          -- set when the underlying condition clears
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe_active
  ON notifications(dedupe_key) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_due ON notifications(notify_at) WHERE sent_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notifications' AND policyname='auth_all_notifications') THEN
    CREATE POLICY "auth_all_notifications" ON notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

INSERT INTO settings (key, value) VALUES
  ('notification_time',    '08:00'),
  ('notifications_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Computes which alerts SHOULD currently exist, opens exactly one active row
-- per condition (dedupe_key), scheduled for the configured notification_time
-- (today if that time hasn't passed yet, else right now so it isn't lost),
-- and resolves rows whose condition is no longer true. Call this from either
-- app -- it is safe to call as often as you like, it never creates
-- duplicates and never fires the same alert twice.
CREATE OR REPLACE FUNCTION generate_due_notifications() RETURNS INT AS $$
DECLARE
  v_time TEXT;
  v_today_at TIMESTAMPTZ;
  v_notify_at TIMESTAMPTZ;
  v_created INT := 0;
  r RECORD;
  v_key TEXT;
BEGIN
  SELECT value INTO v_time FROM settings WHERE key = 'notification_time';
  v_time := COALESCE(v_time, '08:00');
  v_today_at := (CURRENT_DATE::text || ' ' || v_time)::timestamptz;
  v_notify_at := CASE WHEN now() >= v_today_at THEN now() ELSE v_today_at END;

  -- Low stock / out of stock (one open alert per item while condition holds)
  FOR r IN
    SELECT id, name, current_stock, min_stock, unit FROM items
    WHERE active IS TRUE AND current_stock <= min_stock
  LOOP
    v_key := 'stock-' || r.id;
    INSERT INTO notifications (type, severity, dedupe_key, item_id, title, body, link, notify_at)
    VALUES (
      CASE WHEN r.current_stock = 0 THEN 'out_of_stock' ELSE 'low_stock' END,
      CASE WHEN r.current_stock = 0 THEN 'critical' ELSE 'high' END,
      v_key, r.id,
      CASE WHEN r.current_stock = 0 THEN 'OUT OF STOCK: ' || r.name ELSE 'Low Stock: ' || r.name END,
      r.current_stock || ' / min ' || r.min_stock || ' ' || r.unit,
      '/inventory', v_notify_at
    )
    ON CONFLICT (dedupe_key) WHERE resolved_at IS NULL DO NOTHING;
    IF FOUND THEN v_created := v_created + 1; END IF;
  END LOOP;

  -- Resolve stock alerts whose item is no longer low/out.
  UPDATE notifications n SET resolved_at = now()
  WHERE n.resolved_at IS NULL
    AND n.type IN ('low_stock','out_of_stock')
    AND EXISTS (SELECT 1 FROM items i WHERE i.id = n.item_id AND i.current_stock > i.min_stock);

  -- Expiring / expired batches (one open alert per batch while it's active)
  FOR r IN
    SELECT b.id AS batch_id, b.item_id, b.expiry_date, i.name,
           (b.expiry_date - CURRENT_DATE) AS days_left
    FROM item_batches b JOIN items i ON i.id = b.item_id
    WHERE b.remaining_quantity > 0 AND b.expiry_date IS NOT NULL
      AND b.expiry_date <= (CURRENT_DATE + INTERVAL '30 days')
  LOOP
    v_key := 'batch-' || r.batch_id;
    INSERT INTO notifications (type, severity, dedupe_key, item_id, ref_table, ref_id, title, body, link, notify_at)
    VALUES (
      CASE WHEN r.days_left < 0 THEN 'expired' ELSE 'expiring' END,
      CASE WHEN r.days_left < 0 THEN 'critical' WHEN r.days_left <= 7 THEN 'high' ELSE 'medium' END,
      v_key, r.item_id, 'item_batches', r.batch_id,
      CASE WHEN r.days_left < 0 THEN 'EXPIRED: ' || r.name ELSE r.name || ' -- ' || r.days_left || 'd left' END,
      'Expires ' || r.expiry_date, '/expiry', v_notify_at
    )
    ON CONFLICT (dedupe_key) WHERE resolved_at IS NULL DO NOTHING;
    IF FOUND THEN v_created := v_created + 1; END IF;
  END LOOP;

  UPDATE notifications n SET resolved_at = now()
  WHERE n.resolved_at IS NULL AND n.type IN ('expiring','expired')
    AND NOT EXISTS (
      SELECT 1 FROM item_batches b WHERE b.id = n.ref_id AND b.remaining_quantity > 0
        AND b.expiry_date IS NOT NULL AND b.expiry_date <= (CURRENT_DATE + INTERVAL '30 days')
    );

  -- Boat notes still pending delivery.
  FOR r IN
    SELECT id, note_number, note_date FROM boat_notes WHERE status IN ('pending','partially_delivered')
  LOOP
    v_key := 'boatnote-' || r.id;
    INSERT INTO notifications (type, severity, dedupe_key, ref_table, ref_id, title, body, link, notify_at)
    VALUES ('boat_note_pending', 'medium', v_key, 'boat_notes', r.id,
      'Boat Note ' || COALESCE(r.note_number, r.id::text) || ' awaiting delivery',
      'Ordered ' || r.note_date, '/boat-note', v_notify_at)
    ON CONFLICT (dedupe_key) WHERE resolved_at IS NULL DO NOTHING;
    IF FOUND THEN v_created := v_created + 1; END IF;
  END LOOP;

  UPDATE notifications n SET resolved_at = now()
  WHERE n.resolved_at IS NULL AND n.type = 'boat_note_pending'
    AND NOT EXISTS (SELECT 1 FROM boat_notes bn WHERE bn.id = n.ref_id AND bn.status IN ('pending','partially_delivered'));

  RETURN v_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Marks exactly one notification as delivered. Both apps call this once
-- per notification right after showing it -- never in bulk -- so each
-- alert is dispatched individually and never repeated.
CREATE OR REPLACE FUNCTION mark_notification_sent(p_id UUID) RETURNS VOID AS $$
BEGIN
  UPDATE notifications SET sent_at = now() WHERE id = p_id AND sent_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
