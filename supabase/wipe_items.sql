-- ============================================================
-- wipe_items.sql  (MANUAL UTILITY — not a migration)
-- ------------------------------------------------------------
-- Deletes EVERY inventory item so a fresh list can be re-uploaded.
--
-- All tables that reference items(id) use ON DELETE CASCADE
-- (stock_updates, issuances, email_alerts_sent, batches, …) or
-- ON DELETE SET NULL (boat-note lines, claims, manual issues, …),
-- so this single statement clears items and their stock history
-- without breaking referential integrity. Stores, suppliers and
-- settings are left untouched.
--
-- ⚠️  THIS CANNOT BE UNDONE. Run it in the Supabase SQL editor.
-- ============================================================

DELETE FROM items;

-- Optional sanity check (should return 0):
-- SELECT COUNT(*) AS remaining_items FROM items;
