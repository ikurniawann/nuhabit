-- Hasil screening call terstruktur, 1 baris per kandidat (upsert).
-- Field boolean nullable = "belum ditanya"; false = jawaban "tidak".
-- updated_by_name didenormalisasi (pola sama dgn candidate_notes) supaya
-- panel bisa menampilkan HR terakhir yang mengisi tanpa join ke auth.users.

CREATE TABLE IF NOT EXISTS recruitment.candidate_screenings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id      uuid NOT NULL UNIQUE REFERENCES recruitment.candidates(id) ON DELETE CASCADE,
  contacted         boolean NOT NULL DEFAULT false,
  interested        boolean,
  availability_note text,
  confirmed_salary  bigint CHECK (confirmed_salary IS NULL OR confirmed_salary >= 0),
  willing_shift     boolean,
  willing_placement boolean,
  notes             text,
  recommendation    text CHECK (recommendation IN ('lolos', 'hold', 'tidak_lolos')),
  updated_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_name   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
