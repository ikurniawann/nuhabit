-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.behavioral_review_items
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:46.921Z
-- =============================================================================

-- Table: performance.behavioral_review_items
CREATE TABLE "performance"."behavioral_review_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "review_id" uuid NOT NULL,
    "template_behavioral_id" uuid,
    "employee_id" uuid,
    "value_name" character varying(100) NOT NULL,
    "competency" character varying(255),
    "behavioral_standard" text,
    "score_1_description" text,
    "score_2_description" text,
    "score_3_description" text,
    "score_4_description" text,
    "score_5_description" text,
    "weight" numeric(6,2) DEFAULT 0,
    "score" integer,
    "weighted_score" numeric(10,4) DEFAULT 0,
    "notes" text,
    "item_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "performance"."behavioral_review_items"
    ADD CONSTRAINT "behavioral_review_items_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "performance"."behavioral_review_items"
    ADD CONSTRAINT "behavioral_review_items_score_check" CHECK (score >= 1 AND score <= 5);

CREATE INDEX idx_behavioral_review_items_employee ON performance.behavioral_review_items USING btree (employee_id);

CREATE INDEX idx_behavioral_review_items_review ON performance.behavioral_review_items USING btree (review_id);

CREATE INDEX idx_behavioral_review_items_template ON performance.behavioral_review_items USING btree (template_behavioral_id);
