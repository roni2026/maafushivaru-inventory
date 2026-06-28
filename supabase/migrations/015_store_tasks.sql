-- ============================================================
-- 015_store_tasks.sql
-- Store Tasks: lightweight to-dos created from the mobile app (title,
-- details, due time) with a status the team can move through
-- pending → working → done. Visible on both the mobile app and the
-- website. The mobile app schedules a local notification (with sound)
-- at due_at.
-- ============================================================

CREATE TABLE IF NOT EXISTS store_tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL,
  details     TEXT,
  due_at      TIMESTAMPTZ,                       -- reminder / due time
  status      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','working','done')),
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_tasks_due    ON store_tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_store_tasks_status ON store_tasks(status);

-- Keep updated_at fresh (reuses the set_updated_at() function from 001).
DROP TRIGGER IF EXISTS trg_store_tasks_updated_at ON store_tasks;
CREATE TRIGGER trg_store_tasks_updated_at
  BEFORE UPDATE ON store_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Row-level security: authenticated users get full access (matches app model).
ALTER TABLE store_tasks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'store_tasks' AND policyname = 'auth_all_store_tasks'
  ) THEN
    CREATE POLICY "auth_all_store_tasks"
      ON store_tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
