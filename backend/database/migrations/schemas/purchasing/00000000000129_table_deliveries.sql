-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.deliveries
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:02.041Z
-- =============================================================================

-- Table: purchasing.deliveries
CREATE TABLE "purchasing"."deliveries" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "nomor_resi" character varying(100),
    "purchase_order_id" uuid NOT NULL,
    "supplier_id" uuid NOT NULL,
    "tanggal_kirim" date,
    "tanggal_estimasi_tiba" date,
    "tanggal_aktual_tiba" date,
    "kurir" character varying(100),
    "status" character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    "catatan" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" uuid,
    "updated_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "no_surat_jalan" character varying(100),
    "no_resi" character varying(100)
);

ALTER TABLE ONLY "purchasing"."deliveries"
    ADD CONSTRAINT "deliveries_pkey" PRIMARY KEY (id);

CREATE INDEX idx_deliveries_no_resi ON purchasing.deliveries USING btree (no_resi);

CREATE INDEX idx_deliveries_no_surat_jalan ON purchasing.deliveries USING btree (no_surat_jalan);

CREATE INDEX idx_deliveries_po_id ON purchasing.deliveries USING btree (purchase_order_id);

CREATE INDEX idx_deliveries_status ON purchasing.deliveries USING btree (status);

CREATE INDEX idx_deliveries_supplier_id ON purchasing.deliveries USING btree (supplier_id);
