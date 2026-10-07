-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_order_items
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:42.638Z
-- =============================================================================

-- Table: pos.pos_order_items
CREATE TABLE "pos"."pos_order_items" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "order_id" uuid,
    "product_id" uuid,
    "product_name" character varying(200) NOT NULL,
    "product_sku" character varying(50) NOT NULL,
    "variants" jsonb DEFAULT '[]'::jsonb,
    "modifiers" jsonb DEFAULT '[]'::jsonb,
    "quantity" numeric(10,2) DEFAULT 1 NOT NULL,
    "unit_price" numeric(12,2) NOT NULL,
    "subtotal" numeric(12,2) NOT NULL,
    "discount_amount" numeric(12,2) DEFAULT 0,
    "total_amount" numeric(12,2) NOT NULL,
    "inventory_deducted" boolean DEFAULT false,
    "kitchen_status" character varying(20) DEFAULT 'pending'::character varying,
    "kitchen_notes" text,
    "xp_earned" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "station" text,
    "kitchen_started_at" timestamp with time zone,
    "kitchen_ready_at" timestamp with time zone,
    "served_at" timestamp with time zone,
    "cost_price" numeric(15,2) DEFAULT 0 NOT NULL,
    "cost_total" numeric(15,2) DEFAULT 0 NOT NULL,
    "gross_profit" numeric(15,2) DEFAULT 0 NOT NULL,
    "gross_margin_pct" numeric(8,2) DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "pos"."pos_order_items"
    ADD CONSTRAINT "pos_order_items_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "pos"."pos_order_items"
    ADD CONSTRAINT "pos_order_items_kitchen_status_check" CHECK (kitchen_status::text = ANY (ARRAY['pending'::character varying, 'preparing'::character varying, 'ready'::character varying, 'served'::character varying, 'cancelled'::character varying]::text[]));

ALTER TABLE ONLY "pos"."pos_order_items"
    ADD CONSTRAINT "pos_order_items_station_check" CHECK (station = ANY (ARRAY['kitchen'::text, 'bar'::text, 'bakery'::text, 'dessert'::text, 'merchandise'::text, 'photobooth'::text]));

CREATE INDEX idx_pos_order_items_kitchen_status ON pos.pos_order_items USING btree (kitchen_status);

CREATE INDEX idx_pos_order_items_order ON pos.pos_order_items USING btree (order_id);

CREATE INDEX idx_pos_order_items_product ON pos.pos_order_items USING btree (product_id);

CREATE INDEX idx_pos_order_items_profit_report ON pos.pos_order_items USING btree (order_id, product_id);

CREATE INDEX pos_order_items_station_status_idx ON pos.pos_order_items USING btree (station, kitchen_status);
COMMENT ON COLUMN "pos"."pos_order_items"."cost_price" IS 'Snapshot unit HPP/cost at order time, copied from pos_products.cost_price.';
COMMENT ON COLUMN "pos"."pos_order_items"."cost_total" IS 'Snapshot total item cost: cost_price * quantity.';
COMMENT ON COLUMN "pos"."pos_order_items"."gross_profit" IS 'Snapshot gross profit for this item: total_amount - cost_total.';
COMMENT ON COLUMN "pos"."pos_order_items"."gross_margin_pct" IS 'Snapshot gross margin percentage for this item.';
