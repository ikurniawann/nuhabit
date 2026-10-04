-- =============================================================================
-- EPIC-028 Fase A — Season Pass (pass masuk berlaku) untuk modul Ticketing
-- =============================================================================
-- Menambah jenis produk 'season_pass' + 3 tabel: konfigurasi produk pass,
-- pass terbit per pemegang, dan log masuk per pass. Reuse products/bands/gate.
--
-- Keputusan owner (24 Jul 2026): validity ROLLING dari pembelian; entry_policy
-- CONFIGURABLE per produk (once_per_day | unlimited | limited_visits); media QR
-- utama + gelang NFC opsional; MVP entry-only.
--
-- Idempoten (IF NOT EXISTS + DO guard), atomik (runner BEGIN/COMMIT), target dev.
-- =============================================================================

-- 1) Produk ticketing terima jenis ketiga 'season_pass'
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ticket_products_product_kind_check'
    ) THEN
        ALTER TABLE ticketing.ticket_products
            DROP CONSTRAINT ticket_products_product_kind_check;
    END IF;
    ALTER TABLE ticketing.ticket_products
        ADD CONSTRAINT ticket_products_product_kind_check
        CHECK (product_kind::text = ANY (ARRAY['single','bundle','season_pass']::text[]));
END $$;

-- 2) Konfigurasi produk pass (1:1 dgn produk kind='season_pass')
CREATE TABLE IF NOT EXISTS ticketing.ticket_pass_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    ticket_product_id uuid NOT NULL,
    validity_months integer NOT NULL DEFAULT 12,
    entry_policy text NOT NULL DEFAULT 'once_per_day',
    visit_quota integer,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ticket_pass_configs_pkey PRIMARY KEY (id),
    CONSTRAINT ticket_pass_configs_product_uniq UNIQUE (ticket_product_id),
    CONSTRAINT ticket_pass_configs_validity_check CHECK (validity_months > 0),
    CONSTRAINT ticket_pass_configs_entry_policy_check
        CHECK (entry_policy = ANY (ARRAY['once_per_day','unlimited','limited_visits'])),
    -- limited_visits WAJIB punya kuota > 0; selain itu kuota harus NULL
    CONSTRAINT ticket_pass_configs_quota_check CHECK (
        (entry_policy = 'limited_visits' AND visit_quota IS NOT NULL AND visit_quota > 0)
        OR (entry_policy <> 'limited_visits' AND visit_quota IS NULL)
    )
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ticket_pass_configs_product_fkey'
    ) THEN
        ALTER TABLE ticketing.ticket_pass_configs
            ADD CONSTRAINT ticket_pass_configs_product_fkey
            FOREIGN KEY (ticket_product_id)
            REFERENCES ticketing.ticket_products(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 3) Pass terbit (per pemegang)
CREATE TABLE IF NOT EXISTS ticketing.ticket_season_passes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    ticket_product_id uuid NOT NULL,
    pass_code text NOT NULL,
    access_token text NOT NULL,
    holder_name text NOT NULL,
    holder_phone text,
    holder_photo_url text,
    valid_from date,
    valid_until date,
    status text NOT NULL DEFAULT 'pending',
    -- snapshot kebijakan saat terbit (agar perubahan config tak mengubah pass lama)
    entry_policy text NOT NULL DEFAULT 'once_per_day',
    visit_quota_total integer,
    visit_quota_used integer NOT NULL DEFAULT 0,
    band_id uuid,
    band_uid text,
    source text NOT NULL DEFAULT 'loket',
    unit_price numeric(15,2) NOT NULL DEFAULT 0,
    xendit_invoice_id text,
    xendit_invoice_url text,
    payment_expires_at timestamp with time zone,
    paid_at timestamp with time zone,
    activated_at timestamp with time zone,
    customer_id uuid,
    notes text,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ticket_season_passes_pkey PRIMARY KEY (id),
    CONSTRAINT ticket_season_passes_code_uniq UNIQUE (pass_code),
    CONSTRAINT ticket_season_passes_token_uniq UNIQUE (access_token),
    CONSTRAINT ticket_season_passes_status_check
        CHECK (status = ANY (ARRAY['pending','active','expired','suspended','cancelled'])),
    CONSTRAINT ticket_season_passes_entry_policy_check
        CHECK (entry_policy = ANY (ARRAY['once_per_day','unlimited','limited_visits'])),
    CONSTRAINT ticket_season_passes_source_check
        CHECK (source = ANY (ARRAY['loket','online'])),
    CONSTRAINT ticket_season_passes_quota_used_check CHECK (visit_quota_used >= 0),
    CONSTRAINT ticket_season_passes_price_check CHECK (unit_price >= 0)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_season_passes_product_fkey') THEN
        ALTER TABLE ticketing.ticket_season_passes
            ADD CONSTRAINT ticket_season_passes_product_fkey
            FOREIGN KEY (ticket_product_id)
            REFERENCES ticketing.ticket_products(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_season_passes_band_fkey') THEN
        ALTER TABLE ticketing.ticket_season_passes
            ADD CONSTRAINT ticket_season_passes_band_fkey
            FOREIGN KEY (band_id)
            REFERENCES ticketing.ticket_bands(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_season_passes_scope
    ON ticketing.ticket_season_passes (company_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_season_passes_band_uid
    ON ticketing.ticket_season_passes (band_uid) WHERE band_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_season_passes_status
    ON ticketing.ticket_season_passes (status);
CREATE INDEX IF NOT EXISTS idx_season_passes_xendit
    ON ticketing.ticket_season_passes (xendit_invoice_id) WHERE xendit_invoice_id IS NOT NULL;

-- 4) Log masuk per pass (audit + enforcement once/day)
CREATE TABLE IF NOT EXISTS ticketing.ticket_pass_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    season_pass_id uuid NOT NULL,
    entry_date date NOT NULL DEFAULT CURRENT_DATE,
    -- snapshot kebijakan pass (agar unique once/day bisa dibatasi di level DB)
    entry_policy text NOT NULL DEFAULT 'once_per_day',
    gate_label text,
    band_uid text,
    result text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ticket_pass_entries_pkey PRIMARY KEY (id),
    CONSTRAINT ticket_pass_entries_entry_policy_check
        CHECK (entry_policy = ANY (ARRAY['once_per_day','unlimited','limited_visits'])),
    CONSTRAINT ticket_pass_entries_result_check CHECK (
        result = ANY (ARRAY[
            'granted','denied_expired','denied_duplicate',
            'denied_quota','denied_inactive','denied_blackout'
        ])
    )
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_pass_entries_pass_fkey') THEN
        ALTER TABLE ticketing.ticket_pass_entries
            ADD CONSTRAINT ticket_pass_entries_pass_fkey
            FOREIGN KEY (season_pass_id)
            REFERENCES ticketing.ticket_season_passes(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Enforce once_per_day di level DB (anti-race): maks 1 entry GRANTED per (pass,
-- tanggal) HANYA untuk pass berkebijakan once_per_day. Pass 'unlimited' boleh
-- masuk berkali-kali/hari; 'limited_visits' dibatasi kuota, bukan per-hari.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pass_entries_once_per_day
    ON ticketing.ticket_pass_entries (season_pass_id, entry_date)
    WHERE result = 'granted' AND entry_policy = 'once_per_day';

CREATE INDEX IF NOT EXISTS idx_pass_entries_pass
    ON ticketing.ticket_pass_entries (season_pass_id);
