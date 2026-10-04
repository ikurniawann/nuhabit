-- =============================================================================
-- EPIC-036 Fase A — Master hari libur nasional, cuti bersama & libur perusahaan
--
-- Satu sumber kebenaran untuk "tanggal merah", dipakai bersama oleh kalender ESS,
-- monitoring absensi, perhitungan hari cuti, dan (nanti) multiplier lembur.
--
-- Kenapa tabel, bukan API pihak ketiga: daftar resmi terbit lewat SKB 3 Menteri
-- (~September untuk tahun berikutnya) dan tanggal hijriah bisa digeser pemerintah
-- H-beberapa hari. Sumber yang bisa berubah diam-diam tidak boleh menyetir angka
-- yang menyentuh saldo cuti dan gaji. Impor kalender (Fase E) hanya alat bantu
-- yang tetap butuh persetujuan HRD.
--
-- Tanpa company_id — mengikuti seluruh tabel di schema hris; isolasi antar-klien
-- dilakukan per-database (lihat EPIC-035). Libur internal perusahaan dibedakan
-- lewat kolom type.
--
-- Idempoten: aman dijalankan ulang.
-- =============================================================================

CREATE TABLE IF NOT EXISTS hris.public_holidays (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    holiday_date   date NOT NULL,
    name           text NOT NULL,
    type           text NOT NULL DEFAULT 'nasional',
    -- true = hari ini TETAP memotong jatah cuti tahunan. Cuti bersama memotong
    -- (bagian dari cuti tahunan menurut SKB); libur nasional tidak.
    deducts_leave  boolean NOT NULL DEFAULT false,
    -- draft = hasil impor yang belum disetujui HRD; diabaikan seluruh perhitungan
    status         text NOT NULL DEFAULT 'aktif',
    source         text NOT NULL DEFAULT 'manual',
    source_ref     text,          -- UID event kalender → impor ulang idempoten
    note           text,
    created_by     uuid,
    updated_by     uuid,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    deleted_at     timestamptz
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_holidays_type_check') THEN
        ALTER TABLE hris.public_holidays
            ADD CONSTRAINT public_holidays_type_check
            CHECK (type IN ('nasional', 'cuti_bersama', 'perusahaan'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_holidays_status_check') THEN
        ALTER TABLE hris.public_holidays
            ADD CONSTRAINT public_holidays_status_check
            CHECK (status IN ('draft', 'aktif'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_holidays_source_check') THEN
        ALTER TABLE hris.public_holidays
            ADD CONSTRAINT public_holidays_source_check
            CHECK (source IN ('manual', 'impor'));
    END IF;
END $$;

-- Satu tanggal boleh punya lebih dari satu baris (mis. Idul Fitri hari ke-2 yang
-- berdempetan dengan cuti bersama), jadi unique-nya (tanggal, nama).
CREATE UNIQUE INDEX IF NOT EXISTS uq_public_holidays_date_name
    ON hris.public_holidays (holiday_date, name) WHERE deleted_at IS NULL;

-- Jalur baca panas: "libur apa saja di rentang tanggal ini".
CREATE INDEX IF NOT EXISTS idx_public_holidays_date_aktif
    ON hris.public_holidays (holiday_date)
    WHERE deleted_at IS NULL AND status = 'aktif';

COMMENT ON TABLE hris.public_holidays IS
    'Master hari libur (nasional, cuti bersama, perusahaan). Sumber kebenaran tanggal merah; diverifikasi HRD terhadap SKB 3 Menteri.';
COMMENT ON COLUMN hris.public_holidays.deducts_leave IS
    'true = tetap memotong jatah cuti tahunan (cuti bersama). false = tidak memotong (libur nasional).';

-- ── Seed 2026 ───────────────────────────────────────────────────────────────
-- Dikurasi dari kalender hari libur Indonesia, BUKAN disalin mentah. Empat entri
-- sengaja TIDAK dimasukkan karena bukan tanggal merah:
--     2026-02-19  1 Ramadan
--     2026-04-05  Hari Paskah (jatuh Minggu, bukan libur nasional)
--     2026-06-16  Hari Kedua Muharram (artefak batas hari hijriah)
--     2026-12-31  Malam Tahun Baru
-- Dua entri ditandai sumbernya sendiri sebagai tentatif (Waisak, Maulid) dan satu
-- perlu konfirmasi (Idul Adha hari kedua) — semuanya diberi catatan agar HRD
-- mengecek ke SKB resmi. Yang perlu konfirmasi masuk sebagai 'draft' sehingga
-- belum mempengaruhi perhitungan apa pun sampai disetujui.
INSERT INTO hris.public_holidays (holiday_date, name, type, deducts_leave, status, source, note)
VALUES
    ('2026-01-01', 'Tahun Baru Masehi',                  'nasional',     false, 'aktif', 'impor', NULL),
    ('2026-01-16', 'Isra Mikraj Nabi Muhammad SAW',      'nasional',     false, 'aktif', 'impor', NULL),
    ('2026-02-16', 'Cuti Bersama Tahun Baru Imlek',      'cuti_bersama', true,  'aktif', 'impor', NULL),
    ('2026-02-17', 'Tahun Baru Imlek 2577 Kongzili',     'nasional',     false, 'aktif', 'impor', NULL),
    ('2026-03-18', 'Cuti Bersama Hari Suci Nyepi',       'cuti_bersama', true,  'aktif', 'impor', NULL),
    ('2026-03-19', 'Hari Suci Nyepi (Tahun Baru Saka)',  'nasional',     false, 'aktif', 'impor', NULL),
    ('2026-03-20', 'Cuti Bersama Idul Fitri',            'cuti_bersama', true,  'aktif', 'impor', NULL),
    ('2026-03-21', 'Hari Raya Idul Fitri 1447 H',        'nasional',     false, 'aktif', 'impor', NULL),
    ('2026-03-22', 'Hari Raya Idul Fitri 1447 H (hari kedua)', 'nasional', false, 'aktif', 'impor', NULL),
    ('2026-03-23', 'Cuti Bersama Idul Fitri (2)',        'cuti_bersama', true,  'aktif', 'impor', NULL),
    ('2026-03-24', 'Cuti Bersama Idul Fitri (3)',        'cuti_bersama', true,  'aktif', 'impor', NULL),
    ('2026-04-03', 'Wafat Isa Almasih',                  'nasional',     false, 'aktif', 'impor', NULL),
    ('2026-05-01', 'Hari Buruh Internasional',           'nasional',     false, 'aktif', 'impor', NULL),
    ('2026-05-14', 'Kenaikan Isa Almasih',               'nasional',     false, 'aktif', 'impor', NULL),
    ('2026-05-15', 'Cuti Bersama Kenaikan Isa Almasih',  'cuti_bersama', true,  'aktif', 'impor', NULL),
    ('2026-05-27', 'Hari Raya Idul Adha 1447 H',         'nasional',     false, 'aktif', 'impor', NULL),
    ('2026-05-28', 'Hari Raya Idul Adha 1447 H (hari kedua)', 'nasional', false, 'draft', 'impor',
     'Perlu konfirmasi SKB 3 Menteri — sebagian tahun hanya menetapkan satu hari Idul Adha ditambah cuti bersama.'),
    ('2026-05-31', 'Hari Raya Waisak 2570 BE',           'nasional',     false, 'aktif', 'impor',
     'Tanggal ditandai tentatif oleh sumber kalender; verifikasi ke SKB resmi.'),
    ('2026-06-01', 'Hari Lahir Pancasila',               'nasional',     false, 'aktif', 'impor', NULL),
    ('2026-06-17', 'Tahun Baru Islam 1448 H',            'nasional',     false, 'aktif', 'impor', NULL),
    ('2026-08-17', 'Hari Kemerdekaan Republik Indonesia','nasional',     false, 'aktif', 'impor', NULL),
    ('2026-08-25', 'Maulid Nabi Muhammad SAW',           'nasional',     false, 'aktif', 'impor',
     'Tanggal ditandai tentatif oleh sumber kalender; verifikasi ke SKB resmi.'),
    ('2026-12-24', 'Cuti Bersama Hari Raya Natal',       'cuti_bersama', true,  'aktif', 'impor', NULL),
    ('2026-12-25', 'Hari Raya Natal',                    'nasional',     false, 'aktif', 'impor', NULL)
ON CONFLICT DO NOTHING;
