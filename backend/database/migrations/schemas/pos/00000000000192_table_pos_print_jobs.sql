-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_print_jobs
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:45.632Z
-- =============================================================================

-- Table: pos.pos_print_jobs
CREATE TABLE "pos"."pos_print_jobs" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "order_id" uuid,
    "station" text NOT NULL,
    "job_type" text DEFAULT 'kitchen_ticket'::text NOT NULL,
    "status" text DEFAULT 'pending'::text NOT NULL,
    "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" text,
    "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
    "printed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "pos"."pos_print_jobs"
    ADD CONSTRAINT "pos_print_jobs_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "pos"."pos_print_jobs"
    ADD CONSTRAINT "pos_print_jobs_job_type_check" CHECK (job_type = ANY (ARRAY['kitchen_ticket'::text, 'bar_ticket'::text, 'customer_receipt'::text, 'void_ticket'::text]));

ALTER TABLE ONLY "pos"."pos_print_jobs"
    ADD CONSTRAINT "pos_print_jobs_station_check" CHECK (station = ANY (ARRAY['kitchen'::text, 'bar'::text, 'bakery'::text, 'dessert'::text, 'merchandise'::text, 'photobooth'::text]));

ALTER TABLE ONLY "pos"."pos_print_jobs"
    ADD CONSTRAINT "pos_print_jobs_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'printing'::text, 'printed'::text, 'failed'::text, 'cancelled'::text]));

CREATE INDEX pos_print_jobs_order_id_idx ON pos.pos_print_jobs USING btree (order_id);

CREATE UNIQUE INDEX pos_print_jobs_station_order_pending_key ON pos.pos_print_jobs USING btree (order_id, station, job_type) WHERE (status = ANY (ARRAY['pending'::text, 'printing'::text, 'failed'::text]));

CREATE INDEX pos_print_jobs_status_station_idx ON pos.pos_print_jobs USING btree (status, station, requested_at DESC);
