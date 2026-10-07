-- EPIC-029 — Analitik & Ringkasan Percakapan (cache hasil analisa AI).
--
-- Satu baris per percakapan: ringkasan, topik, sentimen, penanda komplain, dan
-- kata kunci hasil analisa model. Tabel ini adalah CACHE, bukan sumber
-- kebenaran — isi chat aslinya tetap di crm.wa_messages.
--
-- `fingerprint` = sidik jari transkrip (lihat src/lib/conversation-analytics/
-- fingerprint.ts). Analisa hanya dijalankan ulang bila sidik jarinya berbeda,
-- jadi membuka laporan berulang kali TIDAK memanggil OpenAI lagi. Inilah
-- pengendali biaya token modul ini.
--
-- Catatan privasi: `summary` memuat inti percakapan (mungkin ber-PII), jadi
-- kolom ini hanya boleh dibaca lewat endpoint ber-guard inbox agent. Laporan
-- agregat cukup memakai topic/sentiment/keywords dan TIDAK menyertakan summary.

CREATE TABLE IF NOT EXISTS crm.wa_conversation_insights (
  conversation_id uuid PRIMARY KEY
    REFERENCES crm.wa_conversations(id) ON DELETE CASCADE,
  summary text,
  topic text,
  sentiment text,
  is_complaint boolean NOT NULL DEFAULT false,
  -- Array kata kunci ternormalisasi (huruf kecil, tanpa stopword).
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  fingerprint text NOT NULL,
  -- Model yang menghasilkan baris ini; berguna saat membandingkan mutu analisa
  -- setelah default model berganti.
  model text,
  analyzed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crm.wa_conversation_insights
  DROP CONSTRAINT IF EXISTS wa_conversation_insights_sentiment_check;
ALTER TABLE crm.wa_conversation_insights
  ADD CONSTRAINT wa_conversation_insights_sentiment_check
  CHECK (sentiment IS NULL OR sentiment = ANY (ARRAY['positif','netral','negatif']));

-- Laporan agregat memfilter per periode lalu mengelompokkan topik/sentimen.
CREATE INDEX IF NOT EXISTS wa_conversation_insights_analyzed_idx
  ON crm.wa_conversation_insights (analyzed_at DESC);
CREATE INDEX IF NOT EXISTS wa_conversation_insights_topic_idx
  ON crm.wa_conversation_insights (topic);
-- Hitung cepat "berapa komplain menurut AI" pada periode laporan.
CREATE INDEX IF NOT EXISTS wa_conversation_insights_complaint_idx
  ON crm.wa_conversation_insights (is_complaint)
  WHERE is_complaint;

COMMENT ON TABLE crm.wa_conversation_insights IS
  'EPIC-029: cache hasil analisa AI per percakapan; invalidasi lewat fingerprint transkrip.';
COMMENT ON COLUMN crm.wa_conversation_insights.fingerprint IS
  'Sidik jari transkrip (jumlah pesan + FNV-1a). Sama = tidak perlu analisa ulang.';
COMMENT ON COLUMN crm.wa_conversation_insights.summary IS
  'Ringkasan 1-2 kalimat. Berpotensi ber-PII: jangan dipakai di laporan agregat.';
