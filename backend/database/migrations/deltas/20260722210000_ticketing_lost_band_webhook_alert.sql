-- EPIC-023 — penutupan keputusan owner + tindak lanjut ops:
-- 1) Gelang hilang: TIDAK butuh perubahan skema (status 'hilang' sudah ada
--    di ticket_bands & ticket_visit_bands sejak Fase A/B) — alurnya hidup
--    di endpoint baru /visits/[id]/bands/[bandId]/lost.
-- 2) Anomali webhook Xendit (PAID utk booking dibatalkan / nominal janggal)
--    kini disimpan di kolom, bukan cuma console.error — tampil di dashboard
--    Booking sampai petugas menandainya selesai.

ALTER TABLE ticketing.ticket_bookings
  ADD COLUMN IF NOT EXISTS webhook_alert text;

COMMENT ON COLUMN ticketing.ticket_bookings.webhook_alert IS
  'Anomali webhook Xendit yang butuh tindak lanjut manual (mis. PAID untuk booking dibatalkan). NULL = tidak ada / sudah ditangani.';
