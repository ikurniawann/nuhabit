-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_order_split_items
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:43.207Z
-- =============================================================================

-- Table: pos.pos_order_split_items
CREATE TABLE "pos"."pos_order_split_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "split_id" uuid NOT NULL,
    "order_item_id" uuid NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(12,2) DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "pos"."pos_order_split_items"
    ADD CONSTRAINT "pos_order_split_items_split_id_order_item_id_key" UNIQUE (split_id, order_item_id);

ALTER TABLE ONLY "pos"."pos_order_split_items"
    ADD CONSTRAINT "pos_order_split_items_pkey" PRIMARY KEY (id);
