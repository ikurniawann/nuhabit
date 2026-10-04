-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_product_modifiers
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:46.219Z
-- =============================================================================

-- Table: pos.pos_product_modifiers
CREATE TABLE "pos"."pos_product_modifiers" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "product_id" uuid,
    "modifier_group_id" uuid
);

ALTER TABLE ONLY "pos"."pos_product_modifiers"
    ADD CONSTRAINT "pos_product_modifiers_product_id_modifier_group_id_key" UNIQUE (product_id, modifier_group_id);

ALTER TABLE ONLY "pos"."pos_product_modifiers"
    ADD CONSTRAINT "pos_product_modifiers_pkey" PRIMARY KEY (id);
