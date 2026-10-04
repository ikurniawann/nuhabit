-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.purchase_orders
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:00.225Z
-- =============================================================================

-- Table: purchasing.purchase_orders
CREATE TABLE "purchasing"."purchase_orders" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "nomor_po" character varying(50) NOT NULL,
    "tanggal_po" date DEFAULT CURRENT_DATE NOT NULL,
    "tanggal_dibutuhkan" date,
    "supplier_id" uuid NOT NULL,
    "status" character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    "subtotal" numeric(15,2) DEFAULT 0 NOT NULL,
    "diskon_persen" numeric(5,2) DEFAULT 0,
    "diskon_nominal" numeric(15,2) DEFAULT 0,
    "ppn_persen" numeric(5,2) DEFAULT 11,
    "ppn_nominal" numeric(15,2) DEFAULT 0,
    "total" numeric(15,2) DEFAULT 0 NOT NULL,
    "catatan" text,
    "terms" text,
    "alamat_pengiriman" text,
    "approved_by" uuid,
    "approved_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" uuid,
    "updated_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "tanggal_kirim_estimasi" date,
    "deleted_at" timestamp with time zone,
    "sent_by" uuid,
    "sent_at" timestamp with time zone,
    "sent_via" character varying(20),
    "cancelled_at" timestamp with time zone,
    "cancelled_by" uuid,
    "cancellation_reason" text,
    "pr_id" uuid,
    "source_type" text,
    "production_order_id" uuid,
    "source_reference" text
);

ALTER TABLE ONLY "purchasing"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_nomor_po_key" UNIQUE (nomor_po);

ALTER TABLE ONLY "purchasing"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "purchasing"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_source_type_check" CHECK (source_type IS NULL OR (source_type = ANY (ARRAY['manual'::text, 'production_order'::text, 'low_stock'::text])));

ALTER TABLE ONLY "purchasing"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_status_check" CHECK (status::text = ANY (ARRAY['draft'::character varying, 'approved'::character varying, 'sent'::character varying, 'partially_received'::character varying, 'received'::character varying, 'cancelled'::character varying]::text[]));

CREATE INDEX idx_po_nomor ON purchasing.purchase_orders USING btree (nomor_po);

CREATE INDEX idx_po_production_order ON purchasing.purchase_orders USING btree (production_order_id) WHERE (production_order_id IS NOT NULL);

CREATE INDEX idx_po_source_type ON purchasing.purchase_orders USING btree (source_type);

CREATE INDEX idx_po_status ON purchasing.purchase_orders USING btree (status);

CREATE INDEX idx_po_supplier_id ON purchasing.purchase_orders USING btree (supplier_id);

CREATE UNIQUE INDEX idx_purchase_orders_pr_id_unique ON purchasing.purchase_orders USING btree (pr_id) WHERE ((pr_id IS NOT NULL) AND (is_active = true));
COMMENT ON COLUMN "purchasing"."purchase_orders"."source_type" IS 'Asal pembuatan PO: manual, production_order, atau low_stock.';
COMMENT ON COLUMN "purchasing"."purchase_orders"."production_order_id" IS 'Production order asal jika PO dibuat untuk shortage bahan produksi.';
COMMENT ON COLUMN "purchasing"."purchase_orders"."source_reference" IS 'Nomor/reference sumber PO untuk audit ringan.';
