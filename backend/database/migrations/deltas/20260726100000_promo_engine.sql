-- =============================================================================
-- EPIC-032 Fase A1 — Engine Promosi bersama (schema promo): campaign, kode,
-- ledger pemakaian. Dipakai lintas modul (Ticketing dulu, POS menyusul C).
-- =============================================================================
-- Keputusan owner (26 Jul 2026): diskon PER TRANSAKSI (bukan per produk);
-- voucher batch nominal sekali-pakai; konsumen pertama = booking online.
-- Legacy pos.pos_vouchers TIDAK dipakai ulang (mati, tanpa tenancy).
--
-- Pola pemakaian (reuse EPIC-031): redemption 'held' saat booking dibuat →
-- 'captured' saat PAID → 'released' saat kedaluwarsa/batal (menumpang jalur
-- status existing, tanpa cron baru).
--
-- Idempoten (IF NOT EXISTS + DO guard), atomik (runner BEGIN/COMMIT), target dev.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS promo;

-- 1) Campaign — induk aturan promo
CREATE TABLE IF NOT EXISTS promo.promo_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL REFERENCES configuration.companies(id),
    branch_id uuid NOT NULL REFERENCES configuration.branches(id),
    name varchar(120) NOT NULL,
    description text,
    discount_type varchar(10) NOT NULL
        CHECK (discount_type IN ('percent', 'fixed')),
    value numeric(14,2) NOT NULL CHECK (value > 0),
    -- Cap rupiah utk percent (NULL = tanpa cap); diabaikan utk fixed
    max_discount numeric(14,2) CHECK (max_discount IS NULL OR max_discount > 0),
    min_purchase numeric(14,2) NOT NULL DEFAULT 0 CHECK (min_purchase >= 0),
    -- NULL = tanpa batas waktu (inklusif kedua ujung, tanggal WIB)
    valid_from date,
    valid_until date,
    -- NULL = tanpa batas total pemakaian (lintas semua kode campaign)
    usage_limit integer CHECK (usage_limit IS NULL OR usage_limit > 0),
    -- NULL = bebas; default 1 = tiap nomor WA hanya sekali per campaign
    per_phone_limit integer DEFAULT 1
        CHECK (per_phone_limit IS NULL OR per_phone_limit > 0),
    -- Di mana kode berlaku (MVP: ticketing_online; pos menyusul Fase C)
    scope varchar(20) NOT NULL DEFAULT 'ticketing_online'
        CHECK (scope IN ('ticketing_online', 'ticketing_loket', 'pos', 'semua')),
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES configuration.users(id),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT promo_campaigns_pkey PRIMARY KEY (id),
    CONSTRAINT promo_campaigns_percent_check
        CHECK (discount_type <> 'percent' OR value <= 100),
    CONSTRAINT promo_campaigns_window_check
        CHECK (valid_from IS NULL OR valid_until IS NULL
               OR valid_until >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_promo_campaigns_venue
    ON promo.promo_campaigns (branch_id, is_active);

-- 2) Kode — 1 campaign bisa SATU kode publik (many uses) ATAU batch
--    ribuan kode unik sekali-pakai (voucher; usage_limit per kode = 1)
CREATE TABLE IF NOT EXISTS promo.promo_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL REFERENCES configuration.companies(id),
    branch_id uuid NOT NULL REFERENCES configuration.branches(id),
    campaign_id uuid NOT NULL
        REFERENCES promo.promo_campaigns(id) ON DELETE CASCADE,
    code varchar(40) NOT NULL,
    -- NULL = ikut usage_limit campaign; 1 = voucher sekali pakai
    usage_limit integer CHECK (usage_limit IS NULL OR usage_limit > 0),
    usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT promo_codes_pkey PRIMARY KEY (id),
    -- Kode diketik pengunjung per venue → unik per branch
    CONSTRAINT promo_codes_code_uniq UNIQUE (branch_id, code)
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_campaign
    ON promo.promo_codes (campaign_id);

-- 3) Ledger pemakaian — append-only + status held/captured/released
CREATE TABLE IF NOT EXISTS promo.promo_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL REFERENCES configuration.companies(id),
    branch_id uuid NOT NULL REFERENCES configuration.branches(id),
    code_id uuid NOT NULL REFERENCES promo.promo_codes(id),
    campaign_id uuid NOT NULL REFERENCES promo.promo_campaigns(id),
    -- Snapshot aturan saat dipakai (edit campaign ≠ ubah riwayat)
    campaign_name varchar(120) NOT NULL,
    discount_type varchar(10) NOT NULL,
    value numeric(14,2) NOT NULL,
    context_type varchar(20) NOT NULL
        CHECK (context_type IN ('ticket_booking', 'pos_order')),
    context_id uuid NOT NULL,
    phone varchar(25),
    customer_id uuid,
    discount_amount numeric(14,2) NOT NULL CHECK (discount_amount >= 0),
    -- held = menunggu bayar; captured = terpakai final; released = lepas
    status varchar(10) NOT NULL DEFAULT 'held'
        CHECK (status IN ('held', 'captured', 'released')),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT promo_redemptions_pkey PRIMARY KEY (id)
);

-- MVP: maksimal 1 kode hidup per transaksi (stacking = Fase E)
CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_redemptions_context
    ON promo.promo_redemptions (context_type, context_id)
    WHERE status <> 'released';

-- Enforcement per_phone_limit: hitung pemakaian hidup per (campaign, phone)
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_phone
    ON promo.promo_redemptions (campaign_id, phone)
    WHERE status <> 'released';

CREATE INDEX IF NOT EXISTS idx_promo_redemptions_code
    ON promo.promo_redemptions (code_id, status);
