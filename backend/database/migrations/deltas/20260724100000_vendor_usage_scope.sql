-- =============================================================================
-- EPIC-026 — Pemisahan vendor F&B vs barang operasional (pemisahan LOGIS)
--
-- Keputusan owner (24 Jul 2026): JANGAN pisah tabel/master. Tabel `vendors`
-- tetap satu (satu buku utang, satu price-list, satu laporan), tetapi diberi
-- penanda peruntukan agar dropdown PO tiap modul hanya menampilkan vendor yang
-- relevan. Satu vendor boleh dipakai di kedua modul (nilai 'keduanya').
--
--   usage_scope = 'fnb'         → hanya muncul di PO produk/F&B
--   usage_scope = 'operasional' → hanya muncul di PO barang operasional (general)
--   usage_scope = 'keduanya'    → muncul di kedua modul
--
-- Backfill: seluruh vendor lama → 'keduanya' (default) supaya TIDAK ada vendor
-- yang tiba-tiba hilang dari dropdown mana pun. Owner menandai ulang belakangan.
-- Idempoten: aman dijalankan ulang.
-- =============================================================================

ALTER TABLE purchasing.vendors
    ADD COLUMN IF NOT EXISTS usage_scope text NOT NULL DEFAULT 'keduanya';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_usage_scope_check') THEN
        ALTER TABLE purchasing.vendors DROP CONSTRAINT vendors_usage_scope_check;
    END IF;
    ALTER TABLE purchasing.vendors
        ADD CONSTRAINT vendors_usage_scope_check
        CHECK (usage_scope = ANY (ARRAY['fnb'::text, 'operasional'::text, 'keduanya'::text]));
END $$;

CREATE INDEX IF NOT EXISTS idx_vendors_usage_scope
    ON purchasing.vendors USING btree (usage_scope);
