-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.staff_schedules
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:08.241Z
-- =============================================================================

-- Table: hris.staff_schedules
CREATE TABLE "hris"."staff_schedules" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "staff_id" uuid NOT NULL,
    "day_of_week" integer NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "is_off" boolean DEFAULT false NOT NULL,
    "effective_from" date DEFAULT CURRENT_DATE NOT NULL,
    "effective_to" date,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."staff_schedules"
    ADD CONSTRAINT "staff_schedules_staff_id_day_of_week_effective_from_key" UNIQUE (staff_id, day_of_week, effective_from);

ALTER TABLE ONLY "hris"."staff_schedules"
    ADD CONSTRAINT "staff_schedules_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "hris"."staff_schedules"
    ADD CONSTRAINT "staff_schedules_day_of_week_check" CHECK (day_of_week >= 0 AND day_of_week <= 6);

CREATE INDEX idx_staff_schedules_staff ON hris.staff_schedules USING btree (staff_id);
