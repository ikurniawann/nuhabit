-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.grn
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:18.956Z
-- =============================================================================

-- Table: purchasing.grn
CREATE TABLE "purchasing"."grn" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "nomor_grn" character varying(100) NOT NULL,
    "delivery_id" uuid,
    "purchase_order_id" uuid NOT NULL,
    "supplier_id" uuid NOT NULL,
    "tanggal_penerimaan" date DEFAULT CURRENT_DATE NOT NULL,
    "penerima_id" uuid,
    "no_surat_jalan" character varying(100),
    "catatan" text,
    "status" character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    "total_item_diterima" integer DEFAULT 0,
    "total_item_ditolak" integer DEFAULT 0,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" uuid,
    "updated_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "receive_count" integer DEFAULT 1
);

ALTER TABLE ONLY "purchasing"."grn"
    ADD CONSTRAINT "grn_nomor_grn_key" UNIQUE (nomor_grn);

ALTER TABLE ONLY "purchasing"."grn"
    ADD CONSTRAINT "grn_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "purchasing"."grn"
    ADD CONSTRAINT "grn_status_check" CHECK (status::text = ANY (ARRAY['pending'::character varying, 'partially_received'::character varying, 'received'::character varying, 'rejected'::character varying]::text[]));

CREATE INDEX idx_grn_delivery_id ON purchasing.grn USING btree (delivery_id);

CREATE INDEX idx_grn_is_active ON purchasing.grn USING btree (is_active);

CREATE INDEX idx_grn_nomor_grn ON purchasing.grn USING btree (nomor_grn);

CREATE INDEX idx_grn_po_id ON purchasing.grn USING btree (purchase_order_id);

CREATE INDEX idx_grn_receive_count ON purchasing.grn USING btree (delivery_id, receive_count);

CREATE INDEX idx_grn_status ON purchasing.grn USING btree (status);

CREATE INDEX idx_grn_supplier_id ON purchasing.grn USING btree (supplier_id);

CREATE INDEX idx_grn_tanggal ON purchasing.grn USING btree (tanggal_penerimaan);
COMMENT ON COLUMN "purchasing"."grn"."receive_count" IS 'Penerimaan ke-berapa untuk delivery ini (1 = pertama, 2 = kedua, dst)';
