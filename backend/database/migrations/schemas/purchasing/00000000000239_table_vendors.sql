-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.vendors
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:14.237Z
-- =============================================================================

-- Table: purchasing.vendors
CREATE TABLE "purchasing"."vendors" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "code" text NOT NULL,
    "name" text NOT NULL,
    "contact_person" text NOT NULL,
    "phone" text NOT NULL,
    "email" text NOT NULL,
    "address" text NOT NULL,
    "category" text NOT NULL,
    "npwp" text,
    "bank_name" text,
    "bank_account" text,
    "bank_account_name" text,
    "is_active" boolean DEFAULT true,
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "purchasing"."vendors"
    ADD CONSTRAINT "vendors_code_key" UNIQUE (code);

ALTER TABLE ONLY "purchasing"."vendors"
    ADD CONSTRAINT "vendors_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "purchasing"."vendors"
    ADD CONSTRAINT "vendors_category_check" CHECK (category = ANY (ARRAY['it'::text, 'office'::text, 'stationery'::text, 'services'::text, 'raw_material'::text, 'other'::text]));

CREATE INDEX idx_vendors_active ON purchasing.vendors USING btree (is_active);

CREATE INDEX idx_vendors_category ON purchasing.vendors USING btree (category);
