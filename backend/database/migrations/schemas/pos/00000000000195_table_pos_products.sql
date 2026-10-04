-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_products
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:47.412Z
-- =============================================================================

-- Table: pos.pos_products
CREATE TABLE "pos"."pos_products" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "sku" character varying(50) NOT NULL,
    "name" character varying(200) NOT NULL,
    "description" text,
    "category_id" uuid,
    "base_price" numeric(12,2) DEFAULT 0 NOT NULL,
    "cost_price" numeric(12,2) DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "is_available" boolean DEFAULT true,
    "inventory_tracking" boolean DEFAULT false,
    "xp_points" integer DEFAULT 0,
    "tax_rate" numeric(5,2) DEFAULT 0,
    "service_charge_rate" numeric(5,2) DEFAULT 0,
    "image_url" text,
    "prep_time_minutes" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "station" text DEFAULT 'kitchen'::text NOT NULL
);

ALTER TABLE ONLY "pos"."pos_products"
    ADD CONSTRAINT "pos_products_sku_key" UNIQUE (sku);

ALTER TABLE ONLY "pos"."pos_products"
    ADD CONSTRAINT "pos_products_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "pos"."pos_products"
    ADD CONSTRAINT "pos_products_station_check" CHECK (station = ANY (ARRAY['kitchen'::text, 'bar'::text, 'bakery'::text, 'dessert'::text, 'merchandise'::text, 'photobooth'::text]));

ALTER TABLE ONLY "pos"."pos_products"
    ADD CONSTRAINT "pos_products_xp_points_positive" CHECK (xp_points >= 0);

CREATE INDEX pos_products_station_idx ON pos.pos_products USING btree (station);

COMMENT ON TABLE "pos"."pos_products" IS 'Product catalog with variants and modifiers support';
COMMENT ON COLUMN "pos"."pos_products"."xp_points" IS 'Default product XP used by CRM loyalty engine when no crm_xp_rules product override exists.';
