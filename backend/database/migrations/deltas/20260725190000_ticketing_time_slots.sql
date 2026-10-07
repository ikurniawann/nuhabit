-- =============================================================================
-- EPIC-031 Fase D1 — Timed-Entry: slot waktu per venue utk booking online
-- =============================================================================
-- Slot = template level VENUE (selaras kuota venue-wide). Booking boleh
-- TANPA slot (NULL = tiket sepanjang hari — backward compatible, venue tanpa
-- slot tidak berubah perilaku). Kuota slot ⊂ kuota harian: slot.capacity
-- NULL = tanpa batas per-slot (jendela jam saja; kuota harian tetap berlaku).
--
-- Jam masuk ditegakkan saat REDEEM loket (gelang baru ada setelah redeem)
-- dengan toleransi configurable ticket_settings.slot_grace_minutes.
-- Snapshot label+jam ke booking: edit template tidak mengubah booking lama.
--
-- Idempoten (IF NOT EXISTS + DO guard), atomik (runner BEGIN/COMMIT), target dev.
-- =============================================================================

-- 1) Template slot per venue
CREATE TABLE IF NOT EXISTS ticketing.ticket_time_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL REFERENCES configuration.companies(id),
    branch_id uuid NOT NULL REFERENCES configuration.branches(id),
    label varchar(80) NOT NULL,
    start_time time NOT NULL,
    end_time time NOT NULL,
    -- NULL = tanpa batas per-slot (jendela jam saja)
    capacity integer,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES configuration.users(id),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ticket_time_slots_pkey PRIMARY KEY (id),
    CONSTRAINT ticket_time_slots_label_uniq UNIQUE (branch_id, label),
    CONSTRAINT ticket_time_slots_capacity_check
        CHECK (capacity IS NULL OR capacity > 0),
    CONSTRAINT ticket_time_slots_window_check CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_ticket_time_slots_venue
    ON ticketing.ticket_time_slots (branch_id, is_active, sort_order);

-- 2) Booking menunjuk slot + SNAPSHOT label/jam (edit template ≠ ubah booking)
ALTER TABLE ticketing.ticket_bookings
    ADD COLUMN IF NOT EXISTS slot_id uuid,
    ADD COLUMN IF NOT EXISTS slot_label varchar(80),
    ADD COLUMN IF NOT EXISTS slot_start_time time,
    ADD COLUMN IF NOT EXISTS slot_end_time time;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ticket_bookings_slot_fkey'
    ) THEN
        ALTER TABLE ticketing.ticket_bookings
            ADD CONSTRAINT ticket_bookings_slot_fkey
            FOREIGN KEY (slot_id)
            REFERENCES ticketing.ticket_time_slots(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Hitung okupansi per (tanggal, slot) utk kuota slot
CREATE INDEX IF NOT EXISTS idx_ticket_bookings_slot_date
    ON ticketing.ticket_bookings (branch_id, visit_date, slot_id)
    WHERE slot_id IS NOT NULL;

-- 3) Toleransi jam masuk saat redeem (menit sebelum mulai / sesudah selesai)
ALTER TABLE ticketing.ticket_settings
    ADD COLUMN IF NOT EXISTS slot_grace_minutes integer NOT NULL DEFAULT 30;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ticket_settings_slot_grace_check'
    ) THEN
        ALTER TABLE ticketing.ticket_settings
            ADD CONSTRAINT ticket_settings_slot_grace_check
            CHECK (slot_grace_minutes >= 0 AND slot_grace_minutes <= 240);
    END IF;
END $$;
