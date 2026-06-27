-- ============================================================
-- 014_store_write_policies.sql
-- Allow authenticated users to MANAGE stores (create / edit / delete).
--
-- Originally `stores` had only a SELECT policy (read-only), so adding,
-- renaming or deleting a store was blocked by row-level security for
-- everyone — including the web app and the mobile app's store manager.
-- These policies mirror the full-access pattern already used for items.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'stores' AND policyname = 'auth_insert_stores'
  ) THEN
    CREATE POLICY "auth_insert_stores"
      ON stores FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'stores' AND policyname = 'auth_update_stores'
  ) THEN
    CREATE POLICY "auth_update_stores"
      ON stores FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'stores' AND policyname = 'auth_delete_stores'
  ) THEN
    CREATE POLICY "auth_delete_stores"
      ON stores FOR DELETE TO authenticated USING (true);
  END IF;
END $$;
