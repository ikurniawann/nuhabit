-- =============================================================================
-- EPIC-034 Fase A — Gift Card / Stored Value: schema kartu + ledger saldo.
-- =============================================================================
-- Keputusan owner (26 Jul 2026, resolusi 5 OQ):
-- (1) media MVP = kode digital (struk + WA), NFC ditunda Fase E;
-- (2) kode saja tanpa PIN (bearer, 12 char CSPRNG, reuse charset promo);
-- (3) pembayaran kasir = 1 transaksi 1 metode, full-cover only (Fase C);
-- (4) nominal & expiry configurable per kartu (bukan hardcode preset);
-- (5) dijual lewat produk POS biasa (Fase B) — laporan liability menyusul E.
--
-- Beda dari promo.promo_codes (potongan sekali pakai): gift card adalah UANG
-- TITIPAN — saldo bisa dipakai berkali-kali (partial redeem) sampai habis.
-- Pola saldo + ledger mengikuti preseden ARK Coin (debit atomik klaim-dulu)
-- dan tab ticketing (ledger dua-arah, FOR UPDATE saat debit).
--
-- Idempoten (IF NOT EXISTS + DO guard), atomik (runner BEGIN/COMMIT), target dev.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS giftcard;

-- 1) Kartu — saldo + status siklus hidup
CREATE TABLE IF NOT EXISTS giftcard.gift_cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL REFERENCES configuration.companies(id),
    branch_id uuid NOT NULL REFERENCES configuration.branches(id),
    -- Bearer code, CSPRNG 12 char (anti-ambigu, tanpa PIN — keputusan owner)
    code varchar(20) NOT NULL,
    initial_value numeric(14,2) NOT NULL CHECK (initial_value > 0),
    balance numeric(14,2) NOT NULL CHECK (balance >= 0),
    -- pending = terbit belum dibayar (jual online); active = siap dipakai;
    -- disabled = dimatikan admin; exhausted = saldo 0 terpakai habis;
    -- expired = lewat expires_at
    status varchar(10) NOT NULL DEFAULT 'active'
        CHECK (status IN ('pending', 'active', 'disabled', 'exhausted', 'expired')),
    -- NULL = tanpa kedaluwarsa (configurable per kartu — keputusan owner)
    expires_at timestamp with time zone,
    -- Sumber terbit: manual admin | pos_order (Fase B) | xendit invoice (Fase D)
    source_type varchar(20) NOT NULL DEFAULT 'manual'
        CHECK (source_type IN ('manual', 'pos_order', 'xendit_invoice')),
    source_id varchar(80),
    buyer_name varchar(120),
    buyer_phone varchar(25),
    note text,
    created_by uuid REFERENCES configuration.users(id),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT gift_cards_pkey PRIMARY KEY (id),
    -- Kode diketik kasir/pembeli per venue → unik per branch (pola promo_codes)
    CONSTRAINT gift_cards_code_uniq UNIQUE (branch_id, code),
    CONSTRAINT gift_cards_balance_le_initial CHECK (balance <= initial_value)
);

CREATE INDEX IF NOT EXISTS idx_gift_cards_venue
    ON giftcard.gift_cards (branch_id, status);

CREATE INDEX IF NOT EXISTS idx_gift_cards_source
    ON giftcard.gift_cards (source_type, source_id);

-- 2) Ledger — append-only, snapshot saldo setelah tiap gerakan
CREATE TABLE IF NOT EXISTS giftcard.gift_card_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL REFERENCES configuration.companies(id),
    branch_id uuid NOT NULL REFERENCES configuration.branches(id),
    card_id uuid NOT NULL REFERENCES giftcard.gift_cards(id),
    -- isi = terbit/top-up; pakai = redeem (debit); koreksi = penyesuaian
    -- manual admin (mis. void order → saldo kembali)
    direction varchar(10) NOT NULL
        CHECK (direction IN ('isi', 'pakai', 'koreksi')),
    amount numeric(14,2) NOT NULL CHECK (amount > 0),
    balance_after numeric(14,2) NOT NULL CHECK (balance_after >= 0),
    context_type varchar(20)
        CHECK (context_type IN ('pos_order', 'ticket_booking', 'manual')),
    context_id uuid,
    note text,
    created_by uuid REFERENCES configuration.users(id),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT gift_card_ledger_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_gift_card_ledger_card
    ON giftcard.gift_card_ledger (card_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gift_card_ledger_context
    ON giftcard.gift_card_ledger (context_type, context_id)
    WHERE context_type IS NOT NULL;
