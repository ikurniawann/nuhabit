-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.grn_items
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:19.543Z
-- =============================================================================

-- Table: purchasing.grn_items
CREATE TABLE "purchasing"."grn_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "grn_id" uuid NOT NULL,
    "delivery_id" uuid,
    "purchase_order_item_id" uuid,
    "raw_material_id" uuid NOT NULL,
    "qty_diterima" numeric(12,4) DEFAULT 0 NOT NULL,
    "qty_ditolak" numeric(12,4) DEFAULT 0 NOT NULL,
    "satuan_id" uuid,
    "kondisi" character varying(20),
    "catatan" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "qty_returned" numeric(10,3) DEFAULT 0,
    "batch_number" character varying(100),
    "expiry_date" date,
    "qc_status" character varying(50) DEFAULT 'rejected'::character varying
);

ALTER TABLE ONLY "purchasing"."grn_items"
    ADD CONSTRAINT "grn_items_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "purchasing"."grn_items"
    ADD CONSTRAINT "grn_items_kondisi_check" CHECK (kondisi::text = ANY (ARRAY['baik'::character varying, 'rusak'::character varying, 'cacat'::character varying]::text[]));

ALTER TABLE ONLY "purchasing"."grn_items"
    ADD CONSTRAINT "grn_items_qc_status_check" CHECK (qc_status::text = ANY (ARRAY['rejected'::character varying, 'partially_rejected'::character varying, 'accepted'::character varying]::text[]));

ALTER TABLE ONLY "purchasing"."grn_items"
    ADD CONSTRAINT "grn_items_qty_returned_check" CHECK (qty_returned >= 0::numeric);

CREATE INDEX idx_grn_items_grn_id ON purchasing.grn_items USING btree (grn_id);

CREATE INDEX idx_grn_items_purchase_order_item_id ON purchasing.grn_items USING btree (purchase_order_item_id);

CREATE INDEX idx_grn_items_raw_material ON purchasing.grn_items USING btree (raw_material_id);
