-- Review EPIC-012 Fase A+B (temuan H2): pencarian customer via digit nomor
-- (regexp_replace) dieksekusi pada SETIAP kirim/terima WA dan sebelumnya
-- selalu sequential scan. Index ekspresi ini membuatnya index lookup.
CREATE INDEX IF NOT EXISTS idx_pos_customers_phone_digits
  ON pos.pos_customers (regexp_replace(COALESCE(phone, ''), '\D', '', 'g'));
