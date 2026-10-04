-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.employee_schedules
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:07.644Z
-- =============================================================================

-- Table: hris.employee_schedules
CREATE TABLE "hris"."employee_schedules" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "employee_id" uuid NOT NULL,
    "day_of_week" integer NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "shift_type" shift_type DEFAULT 'custom'::shift_type NOT NULL,
    "break_minutes" integer DEFAULT 60 NOT NULL,
    "is_off" boolean DEFAULT false NOT NULL,
    "overtime_allowed" boolean DEFAULT false,
    "max_overtime_hours" numeric(5,2) DEFAULT 0,
    "effective_from" date DEFAULT CURRENT_DATE NOT NULL,
    "effective_to" date,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."employee_schedules"
    ADD CONSTRAINT "employee_schedule_unique" UNIQUE (employee_id, day_of_week, effective_from);

ALTER TABLE ONLY "hris"."employee_schedules"
    ADD CONSTRAINT "employee_schedules_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "hris"."employee_schedules"
    ADD CONSTRAINT "break_minutes_positive" CHECK (break_minutes >= 0);

ALTER TABLE ONLY "hris"."employee_schedules"
    ADD CONSTRAINT "employee_schedules_day_of_week_check" CHECK (day_of_week >= 0 AND day_of_week <= 6);

ALTER TABLE ONLY "hris"."employee_schedules"
    ADD CONSTRAINT "schedule_time_valid" CHECK (end_time > start_time);

CREATE INDEX idx_employee_schedules_day ON hris.employee_schedules USING btree (day_of_week);

CREATE INDEX idx_employee_schedules_effective ON hris.employee_schedules USING btree (effective_from, effective_to);

CREATE INDEX idx_employee_schedules_employee ON hris.employee_schedules USING btree (employee_id);

COMMENT ON TABLE "hris"."employee_schedules" IS 'Jadwal kerja karyawan (upgrade dari staff_schedules)';
