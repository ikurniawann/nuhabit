-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.pr_items
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:54.673Z
-- =============================================================================

-- Table: purchasing.pr_items
CREATE TABLE "purchasing"."pr_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "pr_id" uuid NOT NULL,
    "product_id" uuid,
    "description" text NOT NULL,
    "qty" integer NOT NULL,
    "unit" text NOT NULL,
    "estimated_price" numeric(15,2) DEFAULT 0 NOT NULL,
    "total" numeric(15,2) DEFAULT 0 NOT NULL,
    "raw_material_id" uuid,
    "satuan_id" uuid
);

ALTER TABLE ONLY "purchasing"."pr_items"
    ADD CONSTRAINT "pr_items_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "purchasing"."pr_items"
    ADD CONSTRAINT "pr_items_qty_check" CHECK (qty > 0);

CREATE INDEX idx_pr_items_pr_id ON purchasing.pr_items USING btree (pr_id);

CREATE INDEX idx_pr_items_raw_material_id ON purchasing.pr_items USING btree (raw_material_id);

CREATE INDEX idx_pr_items_satuan_id ON purchasing.pr_items USING btree (satuan_id);
