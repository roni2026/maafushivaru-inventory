-- ============================================================
-- 002_seed_stores.sql
-- Seed: 8 stores across 3 categories + default settings
-- ============================================================

INSERT INTO stores (name, category) VALUES
  ('Beverage Dry Store', 'Beverage'),
  ('Dry Store 1',        'Food'),
  ('Dry Store 2',        'Food'),
  ('Dry Store 3',        'Food'),
  ('Freezer 1',          'Food'),
  ('Freezer 2',          'Food'),
  ('General Chemical',   'General'),
  ('General',            'General');

-- Default settings
INSERT INTO settings (key, value) VALUES
  ('brevo_api_key',   ''),
  ('recipient_email', ''),
  ('resort_name',     'Outrigger Maafushivaru Resort'),
  ('alert_enabled',   'true')
ON CONFLICT (key) DO NOTHING;
