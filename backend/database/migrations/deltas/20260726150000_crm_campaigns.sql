-- =============================================================================
-- EPIC-033 Fase A — CRM Lifecycle Campaign: kampanye WA tersegmentasi
-- =============================================================================
-- Keputusan owner (26 Jul): fitur dibangun penuh tapi pengiriman riil
-- DITUNDA (master switch default MATI — WA official sedang disiapkan);
-- plafon harian configurable; segmen MVP = last_visit ≥ N hari + tier +
-- min XP; opt-out marketing = tabel TERPISAH dari wa_consent portal.
-- Idempoten, target dev.

-- 1) Kampanye
CREATE TABLE IF NOT EXISTS crm.crm_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL REFERENCES configuration.companies(id),
    branch_id uuid NOT NULL REFERENCES configuration.branches(id),
    name varchar(120) NOT NULL,
    -- Placeholder: {nama} = nama member, {kode} = voucher (bila ada)
    message_template text NOT NULL,
    -- {last_visit_days: int, tiers: text[], min_xp: int} — divalidasi app
    segment jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Lampiran promo EPIC-032 (Fase C): kode publik ATAU voucher batch
    promo_campaign_id uuid REFERENCES promo.promo_campaigns(id),
    promo_mode varchar(10)
        CHECK (promo_mode IS NULL OR promo_mode IN ('public', 'batch')),
    voucher_prefix varchar(12),
    status varchar(10) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'sending', 'paused', 'done', 'cancelled')),
    -- NULL = ikut plafon global (app_settings crm_campaign_config)
    daily_cap integer CHECK (daily_cap IS NULL OR daily_cap > 0),
    recipients_built boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES configuration.users(id),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT crm_campaigns_pkey PRIMARY KEY (id),
    -- batch WAJIB prefix; public/none tanpa prefix
    CONSTRAINT crm_campaigns_prefix_check CHECK (
        (promo_mode = 'batch' AND voucher_prefix IS NOT NULL)
        OR (COALESCE(promo_mode, 'public') <> 'batch' AND voucher_prefix IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_crm_campaigns_venue
    ON crm.crm_campaigns (branch_id, status);

-- 2) Ledger penerima — klaim-dulu (pola wa_notif_log): 1 member 1 baris
CREATE TABLE IF NOT EXISTS crm.crm_campaign_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL REFERENCES configuration.companies(id),
    branch_id uuid NOT NULL REFERENCES configuration.branches(id),
    campaign_id uuid NOT NULL
        REFERENCES crm.crm_campaigns(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL,
    -- snapshot saat build — edit master tidak mengubah antrean
    name varchar(150) NOT NULL,
    phone varchar(25) NOT NULL,
    voucher_code varchar(40),
    status varchar(10) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    fail_reason text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT crm_campaign_recipients_pkey PRIMARY KEY (id),
    CONSTRAINT crm_campaign_recipients_uniq UNIQUE (campaign_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_campaign_recipients_queue
    ON crm.crm_campaign_recipients (campaign_id, status);
-- Plafon harian dihitung dari sent_at hari ini (lintas kampanye per venue)
CREATE INDEX IF NOT EXISTS idx_crm_campaign_recipients_sent
    ON crm.crm_campaign_recipients (branch_id, sent_at)
    WHERE status = 'sent';

-- 3) Opt-out marketing (TERPISAH dari pos_customers.wa_consent portal)
CREATE TABLE IF NOT EXISTS crm.crm_marketing_optouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL REFERENCES configuration.companies(id),
    branch_id uuid NOT NULL REFERENCES configuration.branches(id),
    phone varchar(25) NOT NULL,
    customer_id uuid,
    source varchar(10) NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'keyword')),
    note varchar(300),
    created_by uuid REFERENCES configuration.users(id),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT crm_marketing_optouts_pkey PRIMARY KEY (id),
    CONSTRAINT crm_marketing_optouts_uniq UNIQUE (branch_id, phone)
);
