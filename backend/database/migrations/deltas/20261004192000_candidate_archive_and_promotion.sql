-- Rekrutmen: status kandidat "archived" & fungsi promosi kandidat yang benar.
--
-- 1. Tombol "Arsipkan" di Talent Pool mengirim status `archived` (sudah ada di
--    tipe, label "Diarsipkan", dan analitik aplikasi), tetapi CHECK lama
--    menolaknya. Arsip = keluar dari talent pool tanpa ditolak.
-- 2. public.promote_candidate_to_employee lama membaca kolom candidates.name
--    (tidak ada), tidak mengisi NIP (NOT NULL), reporting_to, maupun
--    candidates.promoted_to_employee_id. Versi baru melakukan semuanya dalam
--    satu transaksi: kunci baris kandidat, validasi, NIP EMP-<tahun>-<urut>
--    di bawah advisory lock per tahun, insert karyawan, tautkan kandidat.

ALTER TABLE recruitment.candidates DROP CONSTRAINT IF EXISTS candidates_status_check;
ALTER TABLE recruitment.candidates
  ADD CONSTRAINT candidates_status_check CHECK (
    status = ANY (ARRAY[
      'applied', 'screening', 'psikotes', 'interview', 'offer',
      'hired', 'talent_pool', 'rejected', 'archived'
    ])
  );

DROP FUNCTION IF EXISTS public.promote_candidate_to_employee(uuid, date, character varying, uuid, uuid);

CREATE FUNCTION public.promote_candidate_to_employee(
  p_candidate_id uuid,
  p_join_date date,
  p_employment_status character varying,
  p_department_id uuid,
  p_reporting_to uuid
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_candidate recruitment.candidates%ROWTYPE;
  v_year text := to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY');
  v_seq integer;
  v_employee_id uuid;
BEGIN
  SELECT * INTO v_candidate FROM recruitment.candidates WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kandidat tidak ditemukan' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_candidate.promoted_to_employee_id IS NOT NULL THEN
    RAISE EXCEPTION 'Kandidat sudah dipromosikan menjadi employee' USING ERRCODE = 'unique_violation';
  END IF;
  IF v_candidate.status NOT IN ('hired', 'talent_pool') THEN
    RAISE EXCEPTION 'Status kandidat harus hired atau talent_pool' USING ERRCODE = 'check_violation';
  END IF;

  -- Satu alokator NIP per tahun: promosi serentak tidak bisa mendapat nomor sama.
  PERFORM pg_advisory_xact_lock(hashtext('hris.employee-nip-' || v_year));
  SELECT COALESCE(MAX(substring(nip FROM '^EMP-' || v_year || '-(\d+)$')::integer), 0) + 1
    INTO v_seq
    FROM hris.employees
   WHERE nip ~ ('^EMP-' || v_year || '-\d+$');

  INSERT INTO hris.employees (
    nip, full_name, email, phone, join_date, employment_status,
    department_id, job_title_id, reporting_to, is_active
  ) VALUES (
    'EMP-' || v_year || '-' || lpad(v_seq::text, 5, '0'),
    v_candidate.full_name, v_candidate.email, COALESCE(v_candidate.phone, ''),
    p_join_date, p_employment_status,
    p_department_id, v_candidate.position_id, p_reporting_to, true
  ) RETURNING id INTO v_employee_id;

  UPDATE recruitment.candidates
     SET promoted_to_employee_id = v_employee_id, updated_at = now()
   WHERE id = p_candidate_id;

  RETURN v_employee_id;
END;
$$;
