-- Sub-task pada Task Departemen (permintaan owner 2026-08-31):
-- 100% penyelesaian sebuah task dibagi ke sub-task berbobot. Penanggung
-- jawab menceklis sub-task satu per satu; saat total bobot tercentang
-- mencapai 100%, kemunculan otomatis berstatus 'done' (menunggu review
-- HRD, alur lama tidak berubah). Task tanpa sub-task tetap memakai
-- tombol "Tandai Selesai" seperti sebelumnya.

CREATE TABLE IF NOT EXISTS hris.department_task_subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES hris.department_tasks(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  -- bobot dalam persen; jumlah seluruh sub-task sebuah task = 100
  weight numeric(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dept_task_subtasks_task
  ON hris.department_task_subtasks(task_id);

-- Ceklis per kemunculan × sub-task; baris dibuat saat pertama dicentang.
CREATE TABLE IF NOT EXISTS hris.department_task_occurrence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL
    REFERENCES hris.department_task_occurrences(id) ON DELETE CASCADE,
  subtask_id uuid NOT NULL
    REFERENCES hris.department_task_subtasks(id) ON DELETE CASCADE,
  is_checked boolean NOT NULL DEFAULT false,
  checked_at timestamptz,
  checked_by_name varchar(120),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (occurrence_id, subtask_id)
);

-- Reviewer task = Head Division (owner 2026-08-31), bukan HRD — samakan
-- deskripsi indikatornya.
UPDATE performance.kpi_indicators
SET description = 'Persentase tugas departemen (rutin & sekali jalan) yang selesai dan disetujui Head Division pada periodenya.',
    updated_at = now()
WHERE code = 'task_completion';
