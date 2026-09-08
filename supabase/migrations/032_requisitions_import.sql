-- Requisitions imported from the Google Sheet approval portal
CREATE TABLE IF NOT EXISTS requisitions_import (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  sheet_row_hash     text        UNIQUE,
  requisition_number text,
  part_number        text,
  item_name          text,
  unit               text,
  requested_qty      numeric     DEFAULT 0,
  approved_qty       numeric     DEFAULT 0,
  status             text        DEFAULT 'pending',
  imported_at        timestamptz DEFAULT now(),
  order_item_id      uuid        REFERENCES order_history_items(id) ON DELETE SET NULL,
  notes              text,
  raw_data           jsonb
);

CREATE INDEX IF NOT EXISTS idx_ri_part_number ON requisitions_import (part_number);
CREATE INDEX IF NOT EXISTS idx_ri_req_number  ON requisitions_import (requisition_number);
CREATE INDEX IF NOT EXISTS idx_ri_imported_at ON requisitions_import (imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_ri_status      ON requisitions_import (status);

COMMENT ON TABLE requisitions_import IS
  'Requisitions imported from Google Sheets approval portal. '
  'sheet_row_hash prevents duplicate imports. '
  'Matched to order_history_items via part_number.';
