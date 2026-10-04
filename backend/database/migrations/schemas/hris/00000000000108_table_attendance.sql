-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.attendance
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:45.081Z
-- =============================================================================

-- Table: hris.attendance
CREATE TABLE "hris"."attendance" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "employee_id" uuid NOT NULL,
    "date" date NOT NULL,
    "clock_in" timestamp with time zone,
    "clock_out" timestamp with time zone,
    "clock_in_location" jsonb,
    "clock_out_location" jsonb,
    "work_hours" numeric(5,2),
    "break_minutes" integer DEFAULT 60,
    "status" attendance_status DEFAULT 'present'::attendance_status NOT NULL,
    "is_late" boolean DEFAULT false,
    "late_minutes" integer DEFAULT 0,
    "is_overtime" boolean DEFAULT false,
    "overtime_hours" numeric(5,2) DEFAULT 0,
    "validated_by" uuid,
    "validated_at" timestamp with time zone,
    "validation_notes" text,
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."attendance"
    ADD CONSTRAINT "attendance_employee_date_unique" UNIQUE (employee_id, date);

ALTER TABLE ONLY "hris"."attendance"
    ADD CONSTRAINT "attendance_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "hris"."attendance"
    ADD CONSTRAINT "late_minutes_positive" CHECK (late_minutes >= 0);

ALTER TABLE ONLY "hris"."attendance"
    ADD CONSTRAINT "work_hours_positive" CHECK (work_hours >= 0::numeric);

CREATE INDEX idx_attendance_created ON hris.attendance USING btree (created_at);

CREATE INDEX idx_attendance_date ON hris.attendance USING btree (date);

CREATE INDEX idx_attendance_employee ON hris.attendance USING btree (employee_id);

CREATE INDEX idx_attendance_employee_date ON hris.attendance USING btree (employee_id, date DESC);

CREATE INDEX idx_attendance_status ON hris.attendance USING btree (status);

COMMENT ON TABLE "hris"."attendance" IS 'Absensi & timesheet karyawan dengan GPS tracking';
COMMENT ON COLUMN "hris"."attendance"."clock_in_location" IS 'GPS location saat clock-in: {latitude, longitude, accuracy, address, ip_address}';
COMMENT ON COLUMN "hris"."attendance"."work_hours" IS 'Total jam kerja (clock_out - clock_in - break)';
