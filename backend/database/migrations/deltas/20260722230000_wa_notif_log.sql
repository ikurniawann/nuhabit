-- EPIC-020 Fase B — mesin pengirim notifikasi WA owner.
-- Log sekaligus kunci dedup: satu kejadian = satu baris (notif_type +
-- dedup_key unik). Pengirim MENGKLAIM baris dulu (INSERT ON CONFLICT DO
-- NOTHING) sebelum kirim — dua proses/tick tidak pernah mengirim kejadian
-- yang sama dua kali (pola followup-reminder-watcher sales-funnel).

CREATE TABLE IF NOT EXISTS configuration.wa_notif_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notif_type varchar(30) NOT NULL,
  dedup_key varchar(160) NOT NULL,
  message text NOT NULL,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_wa_notif_log_dedup UNIQUE (notif_type, dedup_key)
);

COMMENT ON TABLE configuration.wa_notif_log IS
  'Jejak + dedup notifikasi WA owner (EPIC-020). Baris = kejadian yang sudah/sedang dikirim; klaim-dulu-kirim-kemudian.';
