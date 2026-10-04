-- Floor / lantai for POS table master + floor-plan grouping.
ALTER TABLE pos.pos_tables
  ADD COLUMN IF NOT EXISTS floor text;
