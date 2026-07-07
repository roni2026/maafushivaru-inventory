-- ============================================================
-- 025_batch_safety_auto_expiry_kitchen_reminders.sql
--
-- Three fixes, all continuing the single shared Batch Expiry / notification
-- architecture from 022_unified_batch_expiry.sql -- Website + Android keep
-- using the exact same tables and RPCs, nothing platform-specific.
--
-- 1. SAFE SINGLE-BATCH DEDUCTION (deduct_item_batch)
--    There was no RPC that deducted from ONE specific, caller-chosen batch
--    (only FIFO-across-all-batches via _consume_batches_fifo). Without a
--    guarded, atomic, row-locked operation for this, a naive "deduct N from
--    batch X" implementation could request more than that batch holds and
--    corrupt other batches / zero out the wrong things. deduct_item_batch()
--    locks exactly the target batch row, refuses to deduct more than ITS
--    OWN remaining_quantity (raises a clear error instead), never touches
--    any other batch, and lets the existing trigger recalculate
--    items.current_stock = SUM(remaining_quantity) afterwards. This is the
--    "deduct only from the selected batch unless FIFO/LIFO is explicitly
--    implemented" rule from the spec.
--
-- 2. AUTOMATIC EXPIRED-BATCH -> WASTE LOG PROCESSING
--    Previously a batch only went to Waste Log if it was ALREADY expired at
--    the moment it was added to inventory (see batchStock.js). A batch that
--    was added while healthy and later crosses its expiry date while just
--    sitting in inventory was never removed or logged -- expired stock
--    stayed "active" forever. process_expired_batches() finds every batch
--    with remaining_quantity > 0 and expiry_date < today, zeroes it out
--    (which is what actually reduces inventory -- current_stock stays
--    SUM(remaining_quantity), never touched directly), and inserts exactly
--    one waste_log row per batch (idempotent via auto_wasted_at, so it can
--    never double-log the same batch). It's invoked automatically from
--    generate_due_notifications(), which BOTH apps already call on every
--    poll (Website: NotificationBell every 10 min; Android: HomeScreen on
--    every load/focus) -- no extra client wiring needed, works everywhere.
--
-- 3. KITCHEN REMINDER NOTIFICATIONS (persistent, scheduled, deduped)
--    Replaces the dead, Android-only, per-device issueReminders.js (never
--    actually imported/used anywhere -- which is why reminders felt
--    "random": nothing was actually scheduling them consistently) with a
--    reminder that rides the SAME shared `notifications` table + delivery
--    pipeline already used for low stock / expiry / boat notes. One
--    persistent notification per kitchen per day, generated only while that
--    kitchen actually has a manual_issues row still 'pending_req', at the
--    kitchen's configured time (Main Kitchen 08:30, Kitchen Staff 10:30 by
--    default, editable in Settings), never duplicated, and it naturally
--    stops being (re)created the moment the kitchen has nothing pending.
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Safe single-batch deduction
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION deduct_item_batch(
  p_batch_id   UUID,
  p_quantity   NUMERIC,
  p_reason     TEXT DEFAULT 'Manual adjustment',
  p_note       TEXT DEFAULT NULL,
  p_updated_by TEXT DEFAULT NULL
) RETURNS item_batches AS $$
DECLARE
  v_row item_batches;
  v_remaining NUMERIC;
  v_item_id UUID;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Deduct quantity must be greater than zero';
  END IF;

  -- Lock exactly this batch row -- concurrent deducts/edits on the SAME
  -- batch serialize here; deducts on OTHER batches are unaffected.
  SELECT remaining_quantity, item_id INTO v_remaining, v_item_id
  FROM item_batches WHERE id = p_batch_id FOR UPDATE;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'Batch % not found', p_batch_id;
  END IF;

  IF p_quantity > v_remaining THEN
    RAISE EXCEPTION 'Cannot deduct % -- only % remaining in this batch', p_quantity, v_remaining;
  END IF;

  UPDATE item_batches
  SET remaining_quantity = remaining_quantity - p_quantity, updated_at = now()
  WHERE id = p_batch_id
  RETURNING * INTO v_row;
  -- item_batches_sync_stock trigger recalculates items.current_stock =
  -- SUM(remaining_quantity) for this item right now, automatically.

  INSERT INTO stock_updates (item_id, quantity_change, new_quantity, updated_by, note)
  VALUES (v_item_id, -p_quantity, NULL, p_updated_by, COALESCE(p_note, p_reason || ' (batch ' || p_batch_id || ')'));

  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 2. Automatic expired-batch -> Waste Log processing
-- ------------------------------------------------------------
ALTER TABLE item_batches ADD COLUMN IF NOT EXISTS auto_wasted_at TIMESTAMPTZ;
ALTER TABLE waste_log    ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES item_batches(id) ON DELETE SET NULL;
ALTER TABLE waste_log    ADD COLUMN IF NOT EXISTS expiry_date DATE;
CREATE INDEX IF NOT EXISTS idx_waste_log_batch_id ON waste_log(batch_id);

CREATE OR REPLACE FUNCTION process_expired_batches() RETURNS INT AS $$
DECLARE
  b RECORD;
  v_count INT := 0;
BEGIN
  FOR b IN
    SELECT ib.id, ib.item_id, ib.remaining_quantity, ib.expiry_date, i.name, i.unit_cost
    FROM item_batches ib
    JOIN items i ON i.id = ib.item_id
    WHERE ib.remaining_quantity > 0
      AND ib.expiry_date IS NOT NULL
      AND ib.expiry_date < CURRENT_DATE
      AND ib.auto_wasted_at IS NULL
    FOR UPDATE OF ib
  LOOP
    -- Full audit trail: item, batch, expiry date, quantity wasted,
    -- timestamp, reason = 'Expired' -- exactly the spec.
    INSERT INTO waste_log (item_id, batch_id, quantity, reason, date, expiry_date, logged_by, notes, unit_cost, created_at)
    VALUES (
      b.item_id, b.id, b.remaining_quantity, 'Expired', CURRENT_DATE, b.expiry_date,
      'System (auto-expiry)', 'Batch ' || b.id || ' (' || b.name || ') auto-removed -- expired ' || b.expiry_date,
      COALESCE(b.unit_cost, 0), now()
    );

    -- Zero the batch (never write items.current_stock by hand -- the
    -- trigger recalculates SUM(remaining_quantity) right after this).
    UPDATE item_batches
    SET remaining_quantity = 0, auto_wasted_at = now(), updated_at = now()
    WHERE id = b.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 3. Kitchen reminder notifications -- persistent, scheduled, deduped.
-- ------------------------------------------------------------
INSERT INTO settings (key, value) VALUES
  ('kitchen_reminder_time_main',  '08:30'),
  ('kitchen_reminder_time_staff', '10:30')
ON CONFLICT (key) DO NOTHING;

-- Full redefinition of generate_due_notifications(): everything from
-- 022_unified_batch_expiry.sql is preserved, plus (a) kitchen reminders and
-- (b) an automatic call to process_expired_batches() at the very end so
-- expired stock is wasted right after this poll's "expired" alert has had
-- a chance to fire (both apps already call this RPC on every poll -- no
-- new client wiring needed for either fix).
CREATE OR REPLACE FUNCTION generate_due_notifications() RETURNS INT AS $$
DECLARE
  v_time TEXT;
  v_today_at TIMESTAMPTZ;
  v_notify_at TIMESTAMPTZ;
  v_created INT := 0;
  r RECORD;
  v_key TEXT;
  v_main_time TEXT;
  v_staff_time TEXT;
  v_kitchen_time TEXT;
  v_kitchen_today_at TIMESTAMPTZ;
  v_kitchen_notify_at TIMESTAMPTZ;
  v_pending_count INT;
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

  -- ---- Kitchen reminders: Main Kitchen / Kitchen Staff, once per kitchen
  -- per day, ONLY while that kitchen has an unresolved 'pending_req'
  -- manual_issues row, at that kitchen's configured time. Persistent (a new
  -- day's row is only created if yesterday's is still relevant, i.e. the
  -- underlying issue is still pending) and never duplicated within a day
  -- thanks to the same dedupe_key + partial-unique-index mechanism used
  -- everywhere else in this function.
  SELECT value INTO v_main_time  FROM settings WHERE key = 'kitchen_reminder_time_main';
  SELECT value INTO v_staff_time FROM settings WHERE key = 'kitchen_reminder_time_staff';
  v_main_time  := COALESCE(v_main_time,  '08:30');
  v_staff_time := COALESCE(v_staff_time, '10:30');

  FOR r IN
    SELECT * FROM (VALUES ('MAIN KITCHEN'), ('STAFF KITCHEN')) AS k(kitchen)
  LOOP
    v_kitchen_time := CASE r.kitchen WHEN 'MAIN KITCHEN' THEN v_main_time ELSE v_staff_time END;
    v_kitchen_today_at := (CURRENT_DATE::text || ' ' || v_kitchen_time)::timestamptz;
    v_kitchen_notify_at := CASE WHEN now() >= v_kitchen_today_at THEN now() ELSE v_kitchen_today_at END;

    SELECT count(*) INTO v_pending_count FROM manual_issues
    WHERE kitchen = r.kitchen AND status = 'pending_req';

    IF v_pending_count > 0 THEN
      v_key := 'kitchen-reminder-' || r.kitchen || '-' || CURRENT_DATE;
      INSERT INTO notifications (type, severity, dedupe_key, title, body, link, notify_at)
      VALUES (
        'kitchen_reminder', 'high', v_key,
        initcap(r.kitchen) || ': requisition still pending',
        v_pending_count || ' item(s) issued without a requisition -- please provide it.',
        '/issue-no-req', v_kitchen_notify_at
      )
      ON CONFLICT (dedupe_key) WHERE resolved_at IS NULL DO NOTHING;
      IF FOUND THEN v_created := v_created + 1; END IF;
    END IF;

    -- Resolve any still-open reminder for this kitchen the moment it has
    -- nothing pending left (regardless of which day's row it is).
    UPDATE notifications SET resolved_at = now()
    WHERE resolved_at IS NULL AND type = 'kitchen_reminder'
      AND dedupe_key LIKE ('kitchen-reminder-' || r.kitchen || '-%')
      AND v_pending_count = 0;
  END LOOP;

  -- Automatically move any batch that has now crossed its expiry date into
  -- the Waste Log. Runs last so this poll's "expired" alert (above) is
  -- generated from the pre-waste state first.
  PERFORM process_expired_batches();

  RETURN v_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
