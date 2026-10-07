-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_customers
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:38.829Z
-- =============================================================================

-- Table: pos.pos_customers
CREATE TABLE "pos"."pos_customers" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "phone" character varying(20) NOT NULL,
    "name" character varying(100),
    "email" character varying(100),
    "membership_tier" character varying(20) DEFAULT 'bronze'::character varying,
    "total_xp" integer DEFAULT 0,
    "current_xp" integer DEFAULT 0,
    "ark_coin_balance" numeric(12,2) DEFAULT 0,
    "total_spent" numeric(12,2) DEFAULT 0,
    "visit_count" integer DEFAULT 0,
    "last_visit" timestamp with time zone,
    "notes" text,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_customers"
    ADD CONSTRAINT "pos_customers_phone_key" UNIQUE (phone);

ALTER TABLE ONLY "pos"."pos_customers"
    ADD CONSTRAINT "pos_customers_pkey" PRIMARY KEY (id);

CREATE INDEX idx_pos_customers_phone ON pos.pos_customers USING btree (phone);

CREATE INDEX idx_pos_customers_tier ON pos.pos_customers USING btree (membership_tier);
