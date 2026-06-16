-- ============================================================
-- 003_rls_policies.sql
-- Row Level Security – authenticated users have full access
-- ============================================================

-- Enable RLS on every table
ALTER TABLE stores             ENABLE ROW LEVEL SECURITY;
ALTER TABLE items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_updates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE issuances          ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_alerts_sent  ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings           ENABLE ROW LEVEL SECURITY;

-- ── stores (read-only for auth users) ──────────────────────
CREATE POLICY "auth_select_stores"
  ON stores FOR SELECT TO authenticated USING (true);

-- ── items ──────────────────────────────────────────────────
CREATE POLICY "auth_select_items"
  ON items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_items"
  ON items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_items"
  ON items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete_items"
  ON items FOR DELETE TO authenticated USING (true);

-- ── stock_updates ──────────────────────────────────────────
CREATE POLICY "auth_select_stock_updates"
  ON stock_updates FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_stock_updates"
  ON stock_updates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_stock_updates"
  ON stock_updates FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete_stock_updates"
  ON stock_updates FOR DELETE TO authenticated USING (true);

-- ── issuances ──────────────────────────────────────────────
CREATE POLICY "auth_select_issuances"
  ON issuances FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_issuances"
  ON issuances FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_issuances"
  ON issuances FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete_issuances"
  ON issuances FOR DELETE TO authenticated USING (true);

-- ── email_alerts_sent ──────────────────────────────────────
CREATE POLICY "auth_select_email_alerts"
  ON email_alerts_sent FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_email_alerts"
  ON email_alerts_sent FOR INSERT TO authenticated WITH CHECK (true);

-- ── settings ───────────────────────────────────────────────
CREATE POLICY "auth_select_settings"
  ON settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_settings"
  ON settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_settings"
  ON settings FOR UPDATE TO authenticated USING (true);
