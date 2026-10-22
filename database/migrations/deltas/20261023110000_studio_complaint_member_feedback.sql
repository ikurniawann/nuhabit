-- EPIC-067 T-067-B4 — Laporan & masukan dari Member App.
--   • complaints.kind: 'complaint' (keluhan, ada batas waktu respons/selesai
--     dan eskalasi) atau 'feedback' (masukan/pujian dari member — tanpa batas
--     waktu, prioritas rendah, tidak dieskalasi, tidak dihitung di laporan
--     keluhan B5).
--   • respond_by/resolve_by boleh NULL untuk masukan (kolom sudah nullable).
--   • Tiket dari Member App: source 'member_app', created_by NULL (member,
--     bukan user backoffice); member bisa melihat statusnya dan mengonfirmasi
--     selesai / meminta dibuka lagi.

ALTER TABLE studio.complaints ADD COLUMN IF NOT EXISTS kind varchar(10) NOT NULL DEFAULT 'complaint';
ALTER TABLE studio.complaints DROP CONSTRAINT IF EXISTS complaints_kind_check;
ALTER TABLE studio.complaints ADD CONSTRAINT complaints_kind_check CHECK (kind IN ('complaint', 'feedback'));

CREATE INDEX IF NOT EXISTS idx_studio_complaints_member ON studio.complaints (customer_id, created_at DESC) WHERE source = 'member_app';
