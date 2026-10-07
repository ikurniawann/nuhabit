-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.suppliers
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:10.615Z
-- =============================================================================

-- Table: purchasing.suppliers
CREATE TABLE "purchasing"."suppliers" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "kode" character varying(50) NOT NULL,
    "nama_supplier" character varying(200) NOT NULL,
    "pic_name" character varying(100),
    "pic_phone" character varying(30),
    "email" character varying(100),
    "alamat" text,
    "kota" character varying(100),
    "npwp" character varying(50),
    "payment_terms" character varying(20) DEFAULT 'NET30'::character varying,
    "currency" character varying(3) DEFAULT 'IDR'::character varying,
    "bank_nama" character varying(100),
    "bank_rekening" character varying(50),
    "bank_atas_nama" character varying(100),
    "kategori" character varying(50),
    "status" character varying(20) DEFAULT 'active'::character varying,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "created_by" uuid,
    "updated_by" uuid,
    "telepon" character varying(50),
    "pic_email" character varying(120),
    "catatan" text,
    "deleted_at" timestamp with time zone,
    "deleted_by" uuid
);

ALTER TABLE ONLY "purchasing"."suppliers"
    ADD CONSTRAINT "suppliers_kode_key" UNIQUE (kode);

ALTER TABLE ONLY "purchasing"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "purchasing"."suppliers"
    ADD CONSTRAINT "supplier_status_check" CHECK (status::text = ANY (ARRAY['active'::character varying, 'inactive'::character varying, 'probation'::character varying, 'blocked'::character varying, 'draft'::character varying]::text[]));

ALTER TABLE ONLY "purchasing"."suppliers"
    ADD CONSTRAINT "suppliers_status_check" CHECK (status::text = ANY (ARRAY['active'::character varying, 'inactive'::character varying, 'probation'::character varying, 'blocked'::character varying, 'draft'::character varying]::text[]));

CREATE INDEX idx_suppliers_not_deleted ON purchasing.suppliers USING btree (is_active, nama_supplier) WHERE (deleted_at IS NULL);
COMMENT ON COLUMN "purchasing"."suppliers"."telepon" IS 'Nomor telepon utama perusahaan supplier';
COMMENT ON COLUMN "purchasing"."suppliers"."pic_email" IS 'Email PIC supplier';
COMMENT ON COLUMN "purchasing"."suppliers"."catatan" IS 'Catatan internal supplier';
