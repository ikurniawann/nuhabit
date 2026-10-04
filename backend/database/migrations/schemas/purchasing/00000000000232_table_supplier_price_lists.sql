-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.supplier_price_lists
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:10.025Z
-- =============================================================================

-- Table: purchasing.supplier_price_lists
CREATE TABLE "purchasing"."supplier_price_lists" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "supplier_id" uuid NOT NULL,
    "bahan_baku_id" uuid NOT NULL,
    "harga" numeric(15,2) NOT NULL,
    "satuan_id" uuid,
    "minimum_qty" numeric(15,4) DEFAULT 1 NOT NULL,
    "lead_time_days" integer DEFAULT 0 NOT NULL,
    "is_preferred" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "berlaku_dari" date DEFAULT CURRENT_DATE NOT NULL,
    "berlaku_sampai" date,
    "catatan" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_by" uuid,
    "updated_by" uuid,
    "deleted_at" timestamp with time zone,
    "deleted_by" uuid
);

ALTER TABLE ONLY "purchasing"."supplier_price_lists"
    ADD CONSTRAINT "supplier_price_lists_supplier_id_bahan_baku_id_key" UNIQUE NULLS NOT DISTINCT (supplier_id, bahan_baku_id);

ALTER TABLE ONLY "purchasing"."supplier_price_lists"
    ADD CONSTRAINT "supplier_price_lists_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "purchasing"."supplier_price_lists"
    ADD CONSTRAINT "supplier_price_lists_harga_check" CHECK (harga >= 0::numeric);

ALTER TABLE ONLY "purchasing"."supplier_price_lists"
    ADD CONSTRAINT "supplier_price_lists_lead_time_days_check" CHECK (lead_time_days >= 0);

ALTER TABLE ONLY "purchasing"."supplier_price_lists"
    ADD CONSTRAINT "supplier_price_lists_minimum_qty_check" CHECK (minimum_qty > 0::numeric);

CREATE INDEX idx_supplier_price_list_active ON purchasing.supplier_price_lists USING btree (is_active) WHERE (is_active = true);

CREATE INDEX idx_supplier_price_list_bahan_baku ON purchasing.supplier_price_lists USING btree (bahan_baku_id);

CREATE INDEX idx_supplier_price_list_preferred ON purchasing.supplier_price_lists USING btree (is_preferred) WHERE ((is_preferred = true) AND (is_active = true));

CREATE INDEX idx_supplier_price_list_supplier ON purchasing.supplier_price_lists USING btree (supplier_id);

CREATE INDEX idx_supplier_price_list_validity ON purchasing.supplier_price_lists USING btree (berlaku_dari, berlaku_sampai);

COMMENT ON TABLE "purchasing"."supplier_price_lists" IS 'Harga bahan baku per supplier dengan validity period';
COMMENT ON COLUMN "purchasing"."supplier_price_lists"."harga" IS 'Harga per unit dalam currency supplier';
COMMENT ON COLUMN "purchasing"."supplier_price_lists"."minimum_qty" IS 'Minimum order quantity (MOQ)';
COMMENT ON COLUMN "purchasing"."supplier_price_lists"."lead_time_days" IS 'Estimasi hari dari order sampai barang datang';
COMMENT ON COLUMN "purchasing"."supplier_price_lists"."is_preferred" IS 'Flag untuk preferred supplier (harga prioritas)';
COMMENT ON COLUMN "purchasing"."supplier_price_lists"."berlaku_dari" IS 'Tanggal harga mulai berlaku';
COMMENT ON COLUMN "purchasing"."supplier_price_lists"."berlaku_sampai" IS 'Tanggal harga berlaku sampai (NULL = tanpa batas)';
COMMENT ON COLUMN "purchasing"."supplier_price_lists"."catatan" IS 'Catatan tambahan (syarat pembayaran, kondisi khusus, dll)';
