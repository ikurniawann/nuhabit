-- Floor-plan coordinates for POS tables (percent of canvas, 0–100).
ALTER TABLE pos.pos_tables
  ADD COLUMN IF NOT EXISTS pos_x numeric(8,2),
  ADD COLUMN IF NOT EXISTS pos_y numeric(8,2);
