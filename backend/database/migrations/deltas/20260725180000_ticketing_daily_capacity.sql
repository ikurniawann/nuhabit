-- =============================================================================
-- EPIC-031 Fase A1 — Kuota harian venue (kapasitas per tanggal) utk Ticketing
-- =============================================================================
-- Menambah kapasitas harian venue-wide: default di ticket_settings +
-- override per rentang tanggal. Melunasi defer EPIC-023 D1 ("kuota harian
-- TIDAK ikut MVP; blok-online adalah rem manualnya").
--
-- Keputusan owner (25 Jul 2026):
--   • Kuota VENUE-WIDE per tanggal (bukan per produk), dihitung per ORANG.
--   • daily_capacity NULL = UNLIMITED (perilaku sekarang, nol regresi).
--   • Walk-in loket IKUT mengurangi kuota (enforcement di Fase B).
--   • capacity 0 pada override = tanggal TUTUP (online + walk-in).
--   • Overlap antar override → kapasitas TERKECIL menang (konservatif).
--
-- Idempoten (IF NOT EXISTS + DO guard), atomik (runner BEGIN/COMMIT), target dev.
-- =============================================================================

-- 1) Default kapasitas harian venue — NULL = unlimited
ALTER TABLE ticketing.ticket_settings
    ADD COLUMN IF NOT EXISTS daily_capacity integer;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ticket_settings_daily_capacity_check'
    ) THEN
        ALTER TABLE ticketing.ticket_settings
            ADD CONSTRAINT ticket_settings_daily_capacity_check
            CHECK (daily_capacity IS NULL OR daily_capacity > 0);
    END IF;
END $$;

-- 2) Override kapasitas per rentang tanggal (pola ticket_product_dates,
--    tapi level VENUE — bukan per produk). capacity 0 = tanggal tutup.
CREATE TABLE IF NOT EXISTS ticketing.ticket_capacity_dates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL REFERENCES configuration.companies(id),
    branch_id uuid NOT NULL REFERENCES configuration.branches(id),
    label varchar(120) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    capacity integer NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES configuration.users(id),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ticket_capacity_dates_pkey PRIMARY KEY (id),
    CONSTRAINT ticket_capacity_dates_capacity_check CHECK (capacity >= 0),
    CONSTRAINT ticket_capacity_dates_range_check CHECK (end_date >= start_date)
);

-- Lookup per venue + rentang (resolver A2 & availability B3 query per tanggal)
CREATE INDEX IF NOT EXISTS idx_ticket_capacity_dates_venue_range
    ON ticketing.ticket_capacity_dates (branch_id, start_date, end_date)
    WHERE is_active = true;
