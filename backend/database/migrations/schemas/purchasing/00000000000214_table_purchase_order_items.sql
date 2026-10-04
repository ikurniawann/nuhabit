-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.purchase_order_items
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:59.003Z
-- =============================================================================

-- Table: purchasing.purchase_order_items
CREATE TABLE "purchasing"."purchase_order_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "purchase_order_id" uuid NOT NULL,
    "raw_material_id" uuid NOT NULL,
    "qty_ordered" numeric(12,4) NOT NULL,
    "qty_received" numeric(12,4) DEFAULT 0,
    "qty_remaining" numeric(12,4) GENERATED ALWAYS AS (qty_ordered - qty_received) STORED,
    "satuan_id" uuid,
    "harga_satuan" numeric(15,2) NOT NULL,
    "diskon_item" numeric(15,2) DEFAULT 0,
    "subtotal" numeric(15,2) GENERATED ALWAYS AS ((qty_ordered * harga_satuan) - diskon_item) STORED,
    "catatan" text,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "pr_item_id" uuid
);

ALTER TABLE ONLY "purchasing"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY (id);

CREATE INDEX idx_purchase_order_items_pr_item_id ON purchasing.purchase_order_items USING btree (pr_item_id);
