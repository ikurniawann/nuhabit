-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — functions / procedures
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:14.237Z
-- =============================================================================

-- iam.menus_bump_version
CREATE OR REPLACE FUNCTION iam.menus_bump_version()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.version := COALESCE(OLD.version, 0) + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- iam.menus_set_level
CREATE OR REPLACE FUNCTION iam.menus_set_level()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.level := 1;
  ELSE
    SELECT m.level + 1
    INTO NEW.level
    FROM iam.menus m
    WHERE m.id = NEW.parent_id;

    IF NEW.level IS NULL THEN
      RAISE EXCEPTION 'Parent menu not found for menu %', NEW.code;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- public.calculate_bpjs_deductions
CREATE OR REPLACE FUNCTION public.calculate_bpjs_deductions(monthly_salary numeric, bpjs_tk_enrolled boolean DEFAULT true, bpjs_kes_enrolled boolean DEFAULT true)
 RETURNS TABLE(bpjs_tk_jht numeric, bpjs_tk_jp numeric, bpjs_kes numeric, total_employee numeric, bpjs_tk_jht_employer numeric, bpjs_tk_jp_employer numeric, bpjs_tk_jkk_employer numeric, bpjs_tk_jkm_employer numeric, bpjs_kes_employer numeric, total_employer numeric)
 LANGUAGE plpgsql
AS $function$
DECLARE
  bpjs_tk_max NUMERIC := 10414000; -- UMP 2026 cap for BPJS TK
  bpjs_kes_max NUMERIC := 12000000; -- Cap for BPJS Kesehatan
  calc_salary_tk NUMERIC;
  calc_salary_kes NUMERIC;
BEGIN
  -- Cap salary for BPJS calculation
  calc_salary_tk := LEAST(monthly_salary, bpjs_tk_max);
  calc_salary_kes := LEAST(monthly_salary, bpjs_kes_max);
  
  -- Employee deductions
  bpjs_tk_jht := CASE WHEN bpjs_tk_enrolled THEN calc_salary_tk * 0.02 ELSE 0 END;
  bpjs_tk_jp := CASE WHEN bpjs_tk_enrolled AND monthly_salary >= 5000000 THEN calc_salary_tk * 0.01 ELSE 0 END;
  bpjs_kes := CASE WHEN bpjs_kes_enrolled THEN calc_salary_kes * 0.01 ELSE 0 END;
  total_employee := bpjs_tk_jht + bpjs_tk_jp + bpjs_kes;
  
  -- Employer contributions
  bpjs_tk_jht_employer := CASE WHEN bpjs_tk_enrolled THEN calc_salary_tk * 0.037 ELSE 0 END;
  bpjs_tk_jp_employer := CASE WHEN bpjs_tk_enrolled THEN calc_salary_tk * 0.02 ELSE 0 END;
  bpjs_tk_jkk_employer := CASE WHEN bpjs_tk_enrolled THEN calc_salary_tk * 0.0024 ELSE 0 END;
  bpjs_tk_jkm_employer := CASE WHEN bpjs_tk_enrolled THEN calc_salary_tk * 0.003 ELSE 0 END;
  bpjs_kes_employer := CASE WHEN bpjs_kes_enrolled THEN calc_salary_kes * 0.04 ELSE 0 END;
  total_employer := bpjs_tk_jht_employer + bpjs_tk_jp_employer + bpjs_tk_jkk_employer + bpjs_tk_jkm_employer + bpjs_kes_employer;
  
  RETURN NEXT;
END;
$function$;

-- public.calculate_leave_days
CREATE OR REPLACE FUNCTION public.calculate_leave_days()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.start_date IS NOT NULL AND NEW.end_date IS NOT NULL THEN
    -- Calculate business days (exclude weekends)
    NEW.total_days := (
      SELECT COUNT(*)::NUMERIC
      FROM GENERATE_SERIES(NEW.start_date, NEW.end_date, '1 day'::INTERVAL) AS d(date)
      WHERE EXTRACT(DOW FROM d.date) NOT IN (0, 6) -- Exclude Sunday (0) and Saturday (6)
    );
    
    -- Ensure at least 1 day
    IF NEW.total_days < 1 THEN
      NEW.total_days := 1;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- public.calculate_pph21_etr
CREATE OR REPLACE FUNCTION public.calculate_pph21_etr(annual_taxable_income numeric, ptkp_status text DEFAULT 'TK/0'::text)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
DECLARE
  ptkp_amount NUMERIC := 0;
  taxable_income NUMERIC;
  tax_amount NUMERIC := 0;
  remaining NUMERIC;
BEGIN
  -- Get PTKP based on status
  SELECT 
    CASE ptkp_status
      WHEN 'TK/0' THEN ptkp_tk_0
      WHEN 'TK/1' THEN ptkp_tk_1
      WHEN 'TK/2' THEN ptkp_tk_2
      WHEN 'TK/3' THEN ptkp_tk_3
      WHEN 'K/0' THEN ptkp_k_0
      WHEN 'K/1' THEN ptkp_k_1
      WHEN 'K/2' THEN ptkp_k_2
      WHEN 'K/3' THEN ptkp_k_3
      ELSE ptkp_tk_0
    END INTO ptkp_amount
  FROM payroll_tax_config
  WHERE tax_year = EXTRACT(YEAR FROM CURRENT_DATE)
  LIMIT 1;
  
  -- Calculate taxable income
  taxable_income := GREATEST(0, annual_taxable_income - ptkp_amount);
  
  -- Progressive tax calculation (ETR method)
  remaining := taxable_income;
  
  -- Bracket 1: 0-60jt @ 5%
  IF remaining > 0 THEN
    tax_amount := tax_amount + LEAST(remaining, 60000000) * 0.05;
    remaining := remaining - 60000000;
  END IF;
  
  -- Bracket 2: 60-250jt @ 15%
  IF remaining > 0 THEN
    tax_amount := tax_amount + LEAST(remaining, 190000000) * 0.15;
    remaining := remaining - 190000000;
  END IF;
  
  -- Bracket 3: 250-500jt @ 25%
  IF remaining > 0 THEN
    tax_amount := tax_amount + LEAST(remaining, 250000000) * 0.25;
    remaining := remaining - 250000000;
  END IF;
  
  -- Bracket 4: 500jt-5M @ 30%
  IF remaining > 0 THEN
    tax_amount := tax_amount + LEAST(remaining, 4500000000) * 0.30;
    remaining := remaining - 4500000000;
  END IF;
  
  -- Bracket 5: >5M @ 35%
  IF remaining > 0 THEN
    tax_amount := tax_amount + remaining * 0.35;
  END IF;
  
  RETURN ROUND(tax_amount, 0);
END;
$function$;

-- public.calculate_work_hours
CREATE OR REPLACE FUNCTION public.calculate_work_hours()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.clock_in IS NOT NULL AND NEW.clock_out IS NOT NULL THEN
    -- Calculate hours between clock_in and clock_out, minus break time
    NEW.work_hours := ROUND(
      (EXTRACT(EPOCH FROM (NEW.clock_out - NEW.clock_in)) / 3600.0) 
      - (COALESCE(NEW.break_minutes, 60) / 60.0),
      2
    );
    
    -- Ensure work_hours doesn't go negative
    IF NEW.work_hours < 0 THEN
      NEW.work_hours := 0;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- public.convert_purchase_request_to_po
CREATE OR REPLACE FUNCTION public.convert_purchase_request_to_po(p_pr_id uuid, p_supplier_id uuid, p_tanggal_po date DEFAULT CURRENT_DATE, p_tanggal_kirim_estimasi date DEFAULT NULL::date, p_catatan text DEFAULT NULL::text, p_alamat_pengiriman text DEFAULT NULL::text, p_diskon_persen numeric DEFAULT 0, p_diskon_nominal numeric DEFAULT 0, p_ppn_persen numeric DEFAULT 11, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  pr_record purchase_requests%ROWTYPE;
  new_po_id UUID;
  po_number TEXT;
  year_month TEXT;
  sequence_num INTEGER;
  subtotal_value NUMERIC(15,2);
  discount_value NUMERIC(15,2);
  tax_value NUMERIC(15,2);
  total_value NUMERIC(15,2);
BEGIN
  SELECT *
  INTO pr_record
  FROM purchase_requests
  WHERE id = p_pr_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PR tidak ditemukan';
  END IF;

  IF pr_record.status <> 'approved' THEN
    RAISE EXCEPTION 'Hanya PR approved yang bisa dibuatkan PO';
  END IF;

  IF pr_record.converted_po_id IS NOT NULL THEN
    RAISE EXCEPTION 'PR sudah pernah dibuatkan PO';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pr_items
    WHERE pr_id = p_pr_id
      AND raw_material_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Semua item PR harus memiliki raw material sebelum dibuatkan PO';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pr_items
    WHERE pr_id = p_pr_id
  ) THEN
    RAISE EXCEPTION 'PR tidak memiliki item';
  END IF;

  year_month := 'PO-' || TO_CHAR(NOW(), 'YYYYMM') || '-';

  SELECT COALESCE(MAX(CAST(SUBSTRING(nomor_po FROM LENGTH(year_month) + 1) AS INTEGER)), 0) + 1
  INTO sequence_num
  FROM purchase_orders
  WHERE nomor_po LIKE year_month || '%';

  po_number := year_month || LPAD(sequence_num::TEXT, 4, '0');

  INSERT INTO purchase_orders (
    nomor_po,
    pr_id,
    supplier_id,
    tanggal_po,
    tanggal_kirim_estimasi,
    status,
    catatan,
    alamat_pengiriman,
    diskon_persen,
    diskon_nominal,
    ppn_persen,
    created_by,
    updated_by,
    is_active
  )
  VALUES (
    po_number,
    p_pr_id,
    p_supplier_id,
    COALESCE(p_tanggal_po, CURRENT_DATE),
    p_tanggal_kirim_estimasi,
    'draft',
    p_catatan,
    p_alamat_pengiriman,
    COALESCE(p_diskon_persen, 0),
    COALESCE(p_diskon_nominal, 0),
    COALESCE(p_ppn_persen, 11),
    p_created_by,
    p_created_by,
    TRUE
  )
  RETURNING id INTO new_po_id;

  INSERT INTO purchase_order_items (
    purchase_order_id,
    pr_item_id,
    raw_material_id,
    qty_ordered,
    satuan_id,
    harga_satuan,
    diskon_item,
    catatan,
    is_active
  )
  SELECT
    new_po_id,
    pi.id,
    pi.raw_material_id,
    pi.qty,
    pi.satuan_id,
    pi.estimated_price,
    0,
    pi.description,
    TRUE
  FROM pr_items pi
  WHERE pi.pr_id = p_pr_id;

  SELECT COALESCE(SUM((qty_ordered * harga_satuan) - COALESCE(diskon_item, 0)), 0)
  INTO subtotal_value
  FROM purchase_order_items
  WHERE purchase_order_id = new_po_id
    AND is_active = TRUE;

  IF COALESCE(p_diskon_persen, 0) > 0 THEN
    discount_value := subtotal_value * COALESCE(p_diskon_persen, 0) / 100;
  ELSE
    discount_value := COALESCE(p_diskon_nominal, 0);
  END IF;

  discount_value := LEAST(discount_value, subtotal_value);
  tax_value := (subtotal_value - discount_value) * COALESCE(p_ppn_persen, 11) / 100;
  total_value := subtotal_value - discount_value + tax_value;

  UPDATE purchase_orders
  SET subtotal = subtotal_value,
      diskon_nominal = discount_value,
      ppn_nominal = tax_value,
      total = total_value,
      updated_at = NOW()
  WHERE id = new_po_id;

  UPDATE purchase_requests
  SET status = 'converted',
      converted_po_id = new_po_id,
      updated_at = NOW()
  WHERE id = p_pr_id;

  RETURN new_po_id;
END;
$function$;

-- public.crm_set_updated_at
CREATE OR REPLACE FUNCTION public.crm_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- public.current_employee_id
CREATE OR REPLACE FUNCTION public.current_employee_id()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_employee_id UUID;
BEGIN
  SELECT id INTO v_employee_id FROM employees WHERE user_id = auth.uid();
  RETURN v_employee_id;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$function$;

-- public.current_user_brand_id
CREATE OR REPLACE FUNCTION public.current_user_brand_id()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_brand_id UUID;
BEGIN
  SELECT brand_id INTO v_brand_id
  FROM users
  WHERE id = auth.uid();
  
  RETURN v_brand_id;
END;
$function$;

-- public.current_user_brand_ids
CREATE OR REPLACE FUNCTION public.current_user_brand_ids()
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_brand_ids UUID[];
BEGIN
  SELECT ARRAY_AGG(brand_id) INTO v_brand_ids
  FROM users
  WHERE id = auth.uid() AND brand_id IS NOT NULL;
  
  RETURN COALESCE(v_brand_ids, ARRAY[]::UUID[]);
EXCEPTION
  WHEN OTHERS THEN
    RETURN ARRAY[]::UUID[];
END;
$function$;

-- public.fn_calculate_feedback_summary
CREATE OR REPLACE FUNCTION public.fn_calculate_feedback_summary()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_assignment RECORD;
  v_category_scores RECORD;
BEGIN
  SELECT * INTO v_assignment FROM feedback_assignments WHERE id = NEW.assignment_id;
  
  SELECT 
    AVG(CASE WHEN fc.name = 'Leadership' THEN fr.rating END) as leadership,
    AVG(CASE WHEN fc.name = 'Communication' THEN fr.rating END) as communication,
    AVG(CASE WHEN fc.name = 'Collaboration' THEN fr.rating END) as collaboration,
    AVG(CASE WHEN fc.name = 'Accountability' THEN fr.rating END) as accountability,
    AVG(CASE WHEN fc.name = 'Problem Solving' THEN fr.rating END) as problem_solving,
    COUNT(DISTINCT fr.assignment_id) as cnt
  INTO v_category_scores
  FROM feedback_responses fr
  JOIN feedback_assignments fa ON fr.assignment_id = fa.id
  JOIN feedback_criteria fcr ON fr.criteria_id = fcr.id
  JOIN feedback_categories fc ON fcr.category_id = fc.id
  WHERE fa.cycle_id = v_assignment.cycle_id 
    AND fa.employee_id = v_assignment.employee_id
    AND fa.status = 'completed';
  
  INSERT INTO feedback_summaries (
    cycle_id, employee_id,
    leadership_score, communication_score, collaboration_score,
    accountability_score, problem_solving_score,
    overall_360_score,
    updated_at
  ) VALUES (
    v_assignment.cycle_id,
    v_assignment.employee_id,
    COALESCE(v_category_scores.leadership, 0),
    COALESCE(v_category_scores.communication, 0),
    COALESCE(v_category_scores.collaboration, 0),
    COALESCE(v_category_scores.accountability, 0),
    COALESCE(v_category_scores.problem_solving, 0),
    COALESCE(
      (COALESCE(v_category_scores.leadership, 0) +
       COALESCE(v_category_scores.communication, 0) +
       COALESCE(v_category_scores.collaboration, 0) +
       COALESCE(v_category_scores.accountability, 0) +
       COALESCE(v_category_scores.problem_solving, 0)) / 5.0,
      0
    ),
    now()
  )
  ON CONFLICT (cycle_id, employee_id) DO UPDATE SET
    leadership_score = COALESCE(v_category_scores.leadership, 0),
    communication_score = COALESCE(v_category_scores.communication, 0),
    collaboration_score = COALESCE(v_category_scores.collaboration, 0),
    accountability_score = COALESCE(v_category_scores.accountability, 0),
    problem_solving_score = COALESCE(v_category_scores.problem_solving, 0),
    overall_360_score = COALESCE(
      (COALESCE(v_category_scores.leadership, 0) +
       COALESCE(v_category_scores.communication, 0) +
       COALESCE(v_category_scores.collaboration, 0) +
       COALESCE(v_category_scores.accountability, 0) +
       COALESCE(v_category_scores.problem_solving, 0)) / 5.0,
      0
    ),
    updated_at = now();
  
  RETURN NEW;
END;
$function$;

-- public.fn_notify_attendance_changes
CREATE OR REPLACE FUNCTION public.fn_notify_attendance_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_employee_name text;
  v_employee_user_id uuid;
BEGIN
  SELECT full_name, user_id INTO v_employee_name, v_employee_user_id
  FROM employees WHERE id = COALESCE(NEW.employee_id, OLD.employee_id);

  -- Clock-in baru (terlambat saja yang di-notify agar tidak noisy)
  IF TG_OP = 'INSERT' AND NEW.clock_in IS NOT NULL AND NEW.is_late = true THEN
    PERFORM notify_hrd(
      '⏰ Karyawan Terlambat',
      v_employee_name || ' clock-in terlambat ' || COALESCE(NEW.late_minutes, 0) || ' menit (' ||
        to_char(NEW.clock_in AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') || ' WIB).',
      'alert',
      '/dashboard/hris/attendance'
    );

  -- Clock-out update
  ELSIF TG_OP = 'UPDATE' AND OLD.clock_out IS NULL AND NEW.clock_out IS NOT NULL THEN
    -- Hanya notify jika pulang terlalu cepat (work_hours < 7)
    IF NEW.work_hours IS NOT NULL AND NEW.work_hours < 7 THEN
      PERFORM notify_hrd(
        '⚠️ Jam Kerja Kurang: ' || v_employee_name,
        v_employee_name || ' bekerja hanya ' || round(NEW.work_hours::numeric, 1) || ' jam hari ini.',
        'alert',
        '/dashboard/hris/attendance'
      );
    END IF;

  -- DELETE absensi → notify HRD
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM notify_hrd(
      '🗑️ Data Absensi Dihapus',
      'Data absensi ' || v_employee_name || ' tanggal ' ||
        to_char(OLD.date::date, 'DD Mon YYYY') || ' telah dihapus.',
      'alert',
      '/dashboard/hris/attendance'
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- public.fn_notify_candidate_changes
CREATE OR REPLACE FUNCTION public.fn_notify_candidate_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_position_title text;
  v_status_label text;
  v_old_status_label text;
BEGIN
  SELECT title INTO v_position_title FROM positions WHERE id = COALESCE(NEW.position_id, OLD.position_id);

  v_status_label := CASE COALESCE(NEW.status, OLD.status)
    WHEN 'new'               THEN 'Baru'
    WHEN 'screening'         THEN 'Screening'
    WHEN 'interview_hrd'     THEN 'Interview HRD'
    WHEN 'interview_manager' THEN 'Interview Manager'
    WHEN 'talent_pool'       THEN 'Talent Pool'
    WHEN 'hired'             THEN 'Diterima'
    WHEN 'rejected'          THEN 'Ditolak'
    ELSE COALESCE(NEW.status, OLD.status)
  END;

  IF TG_OP = 'INSERT' THEN
    PERFORM notify_hrd(
      '📥 Kandidat Baru',
      NEW.full_name || ' melamar posisi ' || COALESCE(v_position_title, 'tidak diketahui') ||
        ' (sumber: ' || NEW.source || ').',
      'status_change',
      '/dashboard/hris/candidates/' || NEW.id
    );

  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_old_status_label := CASE OLD.status
      WHEN 'new'               THEN 'Baru'
      WHEN 'screening'         THEN 'Screening'
      WHEN 'interview_hrd'     THEN 'Interview HRD'
      WHEN 'interview_manager' THEN 'Interview Manager'
      WHEN 'talent_pool'       THEN 'Talent Pool'
      WHEN 'hired'             THEN 'Diterima'
      WHEN 'rejected'          THEN 'Ditolak'
      ELSE OLD.status
    END;

    -- Masuk Talent Pool
    IF NEW.status = 'talent_pool' THEN
      PERFORM notify_hrd(
        '⭐ Kandidat Masuk Talent Pool',
        NEW.full_name || ' (' || COALESCE(v_position_title, '—') || ') dipindahkan ke Talent Pool.',
        'status_change',
        '/dashboard/hris/talent-pool'
      );

    -- Diterima (Hired)
    ELSIF NEW.status = 'hired' THEN
      PERFORM notify_hrd(
        '🎉 Kandidat Diterima!',
        NEW.full_name || ' (' || COALESCE(v_position_title, '—') || ') telah diterima sebagai karyawan.',
        'status_change',
        '/dashboard/hris/candidates/' || NEW.id
      );

    -- Ditolak
    ELSIF NEW.status = 'rejected' THEN
      PERFORM notify_hrd(
        '❌ Kandidat Ditolak',
        NEW.full_name || ' (' || COALESCE(v_position_title, '—') || ') ditolak dari proses rekrutmen.',
        'alert',
        '/dashboard/hris/candidates/' || NEW.id
      );

    -- Perubahan pipeline lainnya
    ELSE
      PERFORM notify_hrd(
        '🔄 Status Kandidat: ' || NEW.full_name,
        NEW.full_name || ' (' || COALESCE(v_position_title, '—') || '): ' ||
          v_old_status_label || ' → ' || v_status_label || '.',
        'status_change',
        '/dashboard/hris/candidates/' || NEW.id
      );
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    PERFORM notify_hrd(
      '🗑️ Data Kandidat Dihapus',
      'Data kandidat ' || OLD.full_name || ' (' || COALESCE(v_position_title, '—') || ') telah dihapus.',
      'alert',
      '/dashboard/hris/candidates'
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- public.fn_notify_document_changes
CREATE OR REPLACE FUNCTION public.fn_notify_document_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_employee_name text;
  v_doc_label text;
BEGIN
  SELECT full_name INTO v_employee_name
  FROM employees WHERE id = COALESCE(NEW.employee_id, OLD.employee_id);

  v_doc_label := CASE COALESCE(NEW.document_type, OLD.document_type)
    WHEN 'ktp'      THEN 'KTP'
    WHEN 'npwp'     THEN 'NPWP'
    WHEN 'ijazah'   THEN 'Ijazah'
    WHEN 'cv'       THEN 'CV/Resume'
    WHEN 'kontrak'  THEN 'Kontrak Kerja'
    WHEN 'bpjs_tk'  THEN 'BPJS TK'
    WHEN 'bpjs_kes' THEN 'BPJS Kesehatan'
    ELSE 'Dokumen'
  END;

  IF TG_OP = 'INSERT' THEN
    PERFORM notify_hrd(
      '📎 Dokumen Diupload',
      v_doc_label || ' ' || v_employee_name || ' ("' || NEW.document_name || '") berhasil diupload.',
      'status_change',
      '/dashboard/employees/' || NEW.employee_id
    );

  ELSIF TG_OP = 'DELETE' THEN
    PERFORM notify_hrd(
      '🗑️ Dokumen Dihapus',
      v_doc_label || ' ' || v_employee_name || ' ("' || OLD.document_name || '") telah dihapus.',
      'alert',
      '/dashboard/employees/' || OLD.employee_id
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- public.fn_notify_employee_changes
CREATE OR REPLACE FUNCTION public.fn_notify_employee_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM notify_hrd(
      'Karyawan Baru Ditambahkan',
      NEW.full_name || ' (' || NEW.nip || ') telah bergabung sebagai karyawan baru. Status: ' ||
        CASE NEW.employment_status::TEXT
          WHEN 'permanent'  THEN 'Tetap'
          WHEN 'contract'   THEN 'Kontrak'
          WHEN 'probation'  THEN 'Probasi'
          WHEN 'internship' THEN 'Magang'
          ELSE NEW.employment_status::TEXT
        END || '.',
      'status_change',
      '/dashboard/employees'
    );

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.is_active = true AND NEW.is_active = false THEN
      PERFORM notify_hrd(
        'Karyawan Dinonaktifkan',
        NEW.full_name || ' (' || NEW.nip || ') telah dinonaktifkan.',
        'alert', '/dashboard/employees/' || NEW.id
      );
    ELSIF OLD.is_active = false AND NEW.is_active = true THEN
      PERFORM notify_hrd(
        'Karyawan Diaktifkan Kembali',
        NEW.full_name || ' (' || NEW.nip || ') telah diaktifkan kembali.',
        'status_change', '/dashboard/employees/' || NEW.id
      );
    ELSIF OLD.employment_status IS DISTINCT FROM NEW.employment_status THEN
      PERFORM notify_hrd(
        'Status Kepegawaian Berubah',
        NEW.full_name || ': ' ||
          CASE OLD.employment_status::TEXT WHEN 'permanent' THEN 'Tetap' WHEN 'contract' THEN 'Kontrak' WHEN 'probation' THEN 'Probasi' ELSE OLD.employment_status::TEXT END ||
          ' - ' ||
          CASE NEW.employment_status::TEXT WHEN 'permanent' THEN 'Tetap' WHEN 'contract' THEN 'Kontrak' WHEN 'probation' THEN 'Probasi' WHEN 'resigned' THEN 'Resign' WHEN 'terminated' THEN 'PHK' ELSE NEW.employment_status::TEXT END,
        'status_change', '/dashboard/employees/' || NEW.id
      );
      PERFORM notify_user(
        NEW.user_id,
        'Status Kepegawaian Kamu Berubah',
        'Status kepegawaian kamu telah diubah menjadi: ' ||
          CASE NEW.employment_status::TEXT WHEN 'permanent' THEN 'Karyawan Tetap' WHEN 'contract' THEN 'Kontrak' WHEN 'probation' THEN 'Masa Percobaan' ELSE NEW.employment_status::TEXT END || '.',
        'status_change', '/dashboard/employees/' || NEW.id
      );
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM notify_hrd(
      'Data Karyawan Dihapus',
      'Data karyawan ' || OLD.full_name || ' (' || OLD.nip || ') telah dihapus.',
      'alert', '/dashboard/employees'
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- public.fn_notify_interview_changes
CREATE OR REPLACE FUNCTION public.fn_notify_interview_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_candidate_name text;
  v_interview_type_label text;
BEGIN
  SELECT full_name INTO v_candidate_name FROM candidates WHERE id = COALESCE(NEW.candidate_id, OLD.candidate_id);

  v_interview_type_label := CASE COALESCE(NEW.type, OLD.type)
    WHEN 'hrd'            THEN 'HRD'
    WHEN 'hiring_manager' THEN 'Manager'
    ELSE COALESCE(NEW.type, OLD.type)
  END;

  IF TG_OP = 'INSERT' THEN
    -- Notify HRD
    PERFORM notify_hrd(
      '📅 Interview Dijadwalkan',
      'Interview ' || v_interview_type_label || ' untuk ' || v_candidate_name ||
        ' dijadwalkan: ' || to_char(NEW.interview_date AT TIME ZONE 'Asia/Jakarta', 'DD Mon YYYY HH24:MI') || ' WIB.',
      'reminder',
      '/dashboard/hris/candidates/' || NEW.candidate_id
    );
    -- Notify interviewer langsung
    PERFORM notify_user(
      NEW.interviewer_id,
      '📅 Kamu Dijadwalkan Interview',
      'Kamu dijadwalkan melakukan interview ' || v_interview_type_label ||
        ' dengan ' || v_candidate_name || ' pada ' ||
        to_char(NEW.interview_date AT TIME ZONE 'Asia/Jakarta', 'DD Mon YYYY HH24:MI') || ' WIB.',
      'reminder',
      '/dashboard/hris/candidates/' || NEW.candidate_id
    );

  ELSIF TG_OP = 'UPDATE' AND OLD.recommendation IS DISTINCT FROM NEW.recommendation AND NEW.recommendation IS NOT NULL THEN
    PERFORM notify_hrd(
      '📊 Hasil Interview: ' || v_candidate_name,
      'Rekomendasi interview ' || v_interview_type_label || ' untuk ' || v_candidate_name || ': ' ||
        CASE NEW.recommendation
          WHEN 'proceed' THEN '✅ Lanjutkan'
          WHEN 'pool'    THEN '⭐ Masuk Talent Pool'
          WHEN 'reject'  THEN '❌ Tolak'
          ELSE NEW.recommendation
        END || '.',
      'status_change',
      '/dashboard/hris/candidates/' || NEW.candidate_id
    );

  ELSIF TG_OP = 'DELETE' THEN
    PERFORM notify_hrd(
      '🗑️ Jadwal Interview Dibatalkan',
      'Jadwal interview ' || v_interview_type_label || ' untuk ' || v_candidate_name || ' telah dibatalkan.',
      'alert',
      '/dashboard/hris/candidates/' || OLD.candidate_id
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- public.fn_notify_leave_changes
CREATE OR REPLACE FUNCTION public.fn_notify_leave_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_employee_name text;
  v_employee_user_id uuid;
  v_leave_label text;
BEGIN
  SELECT full_name, user_id INTO v_employee_name, v_employee_user_id
  FROM employees WHERE id = COALESCE(NEW.employee_id, OLD.employee_id);

  v_leave_label := CASE COALESCE(NEW.leave_type, OLD.leave_type)::text
    WHEN 'annual'      THEN 'Tahunan'
    WHEN 'sick'        THEN 'Sakit'
    WHEN 'maternity'   THEN 'Melahirkan'
    WHEN 'paternity'   THEN 'Ayah'
    WHEN 'unpaid'      THEN 'Tidak Dibayar'
    WHEN 'emergency'   THEN 'Darurat'
    WHEN 'pilgrimage'  THEN 'Ibadah Haji/Umrah'
    WHEN 'menstrual'   THEN 'Haid'
    ELSE 'Lainnya'
  END;

  IF TG_OP = 'INSERT' THEN
    PERFORM notify_hrd(
      '📋 Pengajuan Cuti Baru',
      v_employee_name || ' mengajukan cuti ' || v_leave_label ||
        ' (' || NEW.total_days || ' hari) — ' ||
        to_char(NEW.start_date::date, 'DD Mon YYYY') || ' s/d ' ||
        to_char(NEW.end_date::date, 'DD Mon YYYY'),
      'approval',
      '/dashboard/hris/leaves'
    );

  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN

    IF NEW.status = 'approved' THEN
      PERFORM notify_user(
        v_employee_user_id,
        '✅ Cuti Disetujui',
        'Pengajuan cuti ' || v_leave_label || ' kamu (' || NEW.total_days || ' hari) telah disetujui.',
        'status_change',
        '/dashboard/hris/leaves'
      );
      PERFORM notify_hrd(
        '✅ Cuti Disetujui: ' || v_employee_name,
        'Cuti ' || v_leave_label || ' (' || NEW.total_days || ' hari) telah disetujui.',
        'status_change',
        '/dashboard/hris/leaves'
      );

    ELSIF NEW.status = 'rejected' THEN
      PERFORM notify_user(
        v_employee_user_id,
        '❌ Cuti Ditolak',
        'Pengajuan cuti ' || v_leave_label || ' kamu (' || NEW.total_days || ' hari) ditolak.' ||
          CASE WHEN NEW.rejection_reason IS NOT NULL
               THEN ' Alasan: ' || NEW.rejection_reason
               ELSE '' END,
        'alert',
        '/dashboard/hris/leaves'
      );

    ELSIF NEW.status = 'cancelled' THEN
      PERFORM notify_hrd(
        '🚫 Cuti Dibatalkan',
        v_employee_name || ' membatalkan pengajuan cuti ' || v_leave_label || '.',
        'status_change',
        '/dashboard/hris/leaves'
      );
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    PERFORM notify_hrd(
      '🗑️ Pengajuan Cuti Dihapus',
      'Pengajuan cuti ' || v_leave_label || ' dari ' || v_employee_name || ' telah dihapus.',
      'alert',
      '/dashboard/hris/leaves'
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- public.fn_notify_offboarding_changes
CREATE OR REPLACE FUNCTION public.fn_notify_offboarding_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_employee_name text;
  v_resignation_label text;
BEGIN
  SELECT full_name INTO v_employee_name
  FROM employees WHERE id = COALESCE(NEW.employee_id, OLD.employee_id);

  v_resignation_label := CASE COALESCE(NEW.resignation_type, OLD.resignation_type)
    WHEN 'voluntary'       THEN 'Mengundurkan Diri'
    WHEN 'termination'     THEN 'PHK'
    WHEN 'layoff'          THEN 'Layoff'
    WHEN 'end_of_contract' THEN 'Akhir Kontrak'
    ELSE 'Lainnya'
  END;

  IF TG_OP = 'INSERT' THEN
    PERFORM notify_hrd(
      '🚨 Pengajuan Resign Baru',
      v_employee_name || ' mengajukan ' || v_resignation_label ||
        '. Tanggal efektif: ' || to_char(NEW.resignation_date::date, 'DD Mon YYYY') || '.',
      'alert',
      '/dashboard/hris/offboarding/' || NEW.employee_id
    );

  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM notify_hrd(
      '🔄 Status Offboarding: ' || v_employee_name,
      'Status offboarding ' || v_employee_name || ' berubah menjadi: ' ||
        CASE NEW.status
          WHEN 'submitted'      THEN 'Diajukan'
          WHEN 'notice_period'  THEN 'Masa Pemberitahuan'
          WHEN 'exit_interview' THEN 'Exit Interview'
          WHEN 'completed'      THEN 'Selesai'
          ELSE NEW.status
        END || '.',
      'status_change',
      '/dashboard/hris/offboarding/' || NEW.employee_id
    );

  ELSIF TG_OP = 'DELETE' THEN
    PERFORM notify_hrd(
      '🗑️ Data Offboarding Dihapus',
      'Data offboarding ' || v_employee_name || ' telah dihapus.',
      'alert',
      '/dashboard/employees'
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- public.fn_notify_onboarding_changes
CREATE OR REPLACE FUNCTION public.fn_notify_onboarding_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_employee_name text;
  v_total_tasks int;
  v_completed_tasks int;
BEGIN
  SELECT full_name INTO v_employee_name
  FROM employees WHERE id = COALESCE(NEW.employee_id, OLD.employee_id);

  IF TG_OP = 'UPDATE' AND OLD.completed = false AND NEW.completed = true THEN
    -- Cek apakah semua task sudah selesai
    SELECT COUNT(*), COUNT(*) FILTER (WHERE completed = true)
    INTO v_total_tasks, v_completed_tasks
    FROM onboarding_checklists WHERE employee_id = NEW.employee_id;

    IF v_total_tasks = v_completed_tasks THEN
      PERFORM notify_hrd(
        '🎉 Onboarding Selesai',
        'Semua ' || v_total_tasks || ' task onboarding ' || v_employee_name || ' telah diselesaikan!',
        'status_change',
        '/dashboard/hris/onboarding/' || NEW.employee_id
      );
    ELSE
      PERFORM notify_hrd(
        '✅ Task Onboarding Selesai',
        v_employee_name || ' menyelesaikan task: "' || NEW.task_name || '" (' ||
          v_completed_tasks || '/' || v_total_tasks || ' task).',
        'status_change',
        '/dashboard/hris/onboarding/' || NEW.employee_id
      );
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    PERFORM notify_hrd(
      '🗑️ Task Onboarding Dihapus',
      'Task onboarding "' || OLD.task_name || '" untuk ' || v_employee_name || ' telah dihapus.',
      'alert',
      '/dashboard/hris/onboarding/' || OLD.employee_id
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- public.fn_record_employee_hire
CREATE OR REPLACE FUNCTION public.fn_record_employee_hire()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO employment_history (
    employee_id, change_type, effective_date,
    new_department_id, new_section_id, new_job_title_id,
    new_employment_status, reason
  ) VALUES (
    NEW.id, 'hire', NEW.join_date,
    NEW.department_id, NEW.section_id, NEW.job_title_id,
    NEW.employment_status::TEXT, 'Bergabung sebagai karyawan baru'
  );
  RETURN NEW;
END;
$function$;

-- public.generate_gr_number
CREATE OR REPLACE FUNCTION public.generate_gr_number()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
    year TEXT;
    last_num INTEGER;
    new_num INTEGER;
BEGIN
    year := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
    
    SELECT COALESCE(
        MAX(CAST(SPLIT_PART(nomor_grn, '-', 3) AS INTEGER)),
        0
    )
    INTO last_num
    FROM grn
    WHERE nomor_grn LIKE 'GR-' || year || '-%';
    
    new_num := last_num + 1;
    
    RETURN 'GR-' || year || '-' || LPAD(new_num::TEXT, 5, '0');
END;
$function$;

-- public.generate_nip
CREATE OR REPLACE FUNCTION public.generate_nip()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_year TEXT;
  v_sequence TEXT;
  v_new_nip TEXT;
  v_max_seq INTEGER;
BEGIN
  -- Get current year
  v_year := TO_CHAR(NOW(), 'YYYY');
  
  -- Get next sequence number for this year
  SELECT MAX(CAST(SUBSTRING(nip FROM ('EMP-' || v_year || '-(\\d+)$')) AS INTEGER))
  INTO v_max_seq
  FROM employees
  WHERE nip LIKE ('EMP-' || v_year || '-%');
  
  -- Calculate next sequence (pad with zeros) - CAST TO TEXT!
  v_sequence := LPAD((COALESCE(v_max_seq, 0) + 1)::TEXT, 5, '0');
  
  -- Build NIP
  v_new_nip := 'EMP-' || v_year || '-' || v_sequence;
  
  RETURN v_new_nip;
END;
$function$;

-- public.generate_onboarding_checklist
CREATE OR REPLACE FUNCTION public.generate_onboarding_checklist()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_join_date DATE;
BEGIN
  v_join_date := COALESCE(NEW.join_date, CURRENT_DATE);
  
  -- Insert default onboarding tasks
  INSERT INTO onboarding_checklists (
    employee_id,
    task_name,
    category,
    description,
    due_date,
    due_days_after_join,
    priority
  ) VALUES
  -- HR Tasks
  (NEW.id, 'Submit KTP & NPWP', 'hr', 'Upload scan KTP dan NPWP', v_join_date + INTERVAL '7 days', 7, 1),
  (NEW.id, 'Submit Foto Profil', 'hr', 'Foto formal 3x4 dan 4x6', v_join_date + INTERVAL '7 days', 7, 2),
  (NEW.id, 'Sign Kontrak Kerja', 'hr', 'Tanda tangan kontrak kerja', v_join_date + INTERVAL '3 days', 3, 1),
  (NEW.id, 'Registrasi BPJS', 'hr', 'Daftar BPJS Kesehatan & Ketenagakerjaan', v_join_date + INTERVAL '14 days', 14, 2),
  
  -- IT Tasks
  (NEW.id, 'Setup Email Perusahaan', 'it', 'Aktivasi email @arkiv.co.id', v_join_date + INTERVAL '1 day', 1, 1),
  (NEW.id, 'Setup Laptop & Equipment', 'it', 'Penerimaan laptop dan perlengkapan', v_join_date, 0, 1),
  (NEW.id, 'Access System & Tools', 'it', 'Akses Slack, GitHub, Jira, dll', v_join_date + INTERVAL '1 day', 1, 1),
  
  -- Manager Tasks
  (NEW.id, 'Team Introduction', 'manager', 'Perkenalan dengan tim', v_join_date, 0, 1),
  (NEW.id, 'Job Description Review', 'manager', 'Review JD dan ekspektasi kinerja', v_join_date + INTERVAL '3 days', 3, 2),
  (NEW.id, 'Goal Setting (30-60-90 days)', 'manager', 'Set goals untuk 30/60/90 hari pertama', v_join_date + INTERVAL '7 days', 7, 2),
  
  -- Admin Tasks
  (NEW.id, 'ID Card & Access Card', 'admin', 'Pembuatan kartu identitas dan akses', v_join_date + INTERVAL '3 days', 3, 2),
  (NEW.id, 'Locker & Workspace Setup', 'admin', 'Penyiapan locker dan workspace', v_join_date, 0, 2);
  
  RETURN NEW;
END;
$function$;

-- public.generate_order_number
CREATE OR REPLACE FUNCTION public.generate_order_number()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  today_prefix text;
  seq_num integer;
  new_number text;
BEGIN
  today_prefix := 'POS-' || to_char(now(), 'YYYYMMDD');
  
  -- Get current max sequence for today
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(order_number FROM LENGTH(today_prefix) + 2) AS integer)
  ), 0) INTO seq_num
  FROM pos_orders
  WHERE order_number LIKE today_prefix || '-%';
  
  new_number := today_prefix || '-' || LPAD((seq_num + 1)::text, 4, '0');
  RETURN new_number;
END;
$function$;

-- public.generate_po_number
CREATE OR REPLACE FUNCTION public.generate_po_number()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
    year TEXT;
    last_num INTEGER;
    new_num INTEGER;
BEGIN
    year := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
    
    SELECT COALESCE(
        MAX(CAST(SPLIT_PART(po_number, '-', 3) AS INTEGER)),
        0
    )
    INTO last_num
    FROM purchase_orders
    WHERE po_number LIKE 'PO-' || year || '-%';
    
    new_num := last_num + 1;
    
    RETURN 'PO-' || year || '-' || LPAD(new_num::TEXT, 5, '0');
END;
$function$;

-- public.generate_pr_number
CREATE OR REPLACE FUNCTION public.generate_pr_number()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
    year TEXT;
    last_num INTEGER;
    new_num INTEGER;
BEGIN
    year := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
    
    SELECT COALESCE(
        MAX(CAST(SPLIT_PART(pr_number, '-', 3) AS INTEGER)),
        0
    )
    INTO last_num

    FROM purchase_requests
    WHERE pr_number LIKE 'PR-' || year || '-%';
    
    new_num := last_num + 1;
    
    RETURN 'PR-' || year || '-' || LPAD(new_num::TEXT, 5, '0');
END;
$function$;

-- public.generate_return_number
CREATE OR REPLACE FUNCTION public.generate_return_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  year_part TEXT;
  seq_num INTEGER;
  return_num TEXT;
BEGIN
  year_part := TO_CHAR(NEW.return_date, 'YYYY');
  
  -- Count existing returns this year and add 1
  SELECT COUNT(*) + 1 INTO seq_num
  FROM purchase_returns
  WHERE return_number LIKE 'RET-' || year_part || '-%';
  
  -- Format: RET-2026-001
  return_num := 'RET-' || year_part || '-' || LPAD(seq_num::TEXT, 3, '0');
  
  NEW.return_number := return_num;
  RETURN NEW;
END;
$function$;

-- public.generate_vendor_credit_number
CREATE OR REPLACE FUNCTION public.generate_vendor_credit_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  year_part text;
  seq_num integer;
  credit_num text;
BEGIN
  year_part := TO_CHAR(COALESCE(NEW.credit_date, CURRENT_DATE), 'YYYY');

  SELECT COUNT(*) + 1 INTO seq_num
  FROM purchasing.vendor_credits
  WHERE credit_number LIKE 'VCR-' || year_part || '-%';

  credit_num := 'VCR-' || year_part || '-' || LPAD(seq_num::text, 3, '0');
  NEW.credit_number := credit_num;
  RETURN NEW;
END;
$function$;

-- public.generate_shift_number
CREATE OR REPLACE FUNCTION public.generate_shift_number()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_date TEXT := to_char(NOW(), 'YYYYMMDD');
  v_count INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(shift_number FROM 13 FOR 4) AS INTEGER)), 0)
  INTO v_count
  FROM pos_shifts
  WHERE shift_number LIKE 'SHF-' || v_date || '-%';
  
  RETURN 'SHF-' || v_date || '-' || LPAD((v_count + 1)::TEXT, 4, '0');
END;
$function$;

-- public.generate_vendor_document_intake_number
CREATE OR REPLACE FUNCTION public.generate_vendor_document_intake_number()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_prefix TEXT;
  v_last_number INTEGER;
BEGIN
  v_prefix := 'VDI-' || TO_CHAR(NOW(), 'YYYYMM') || '-';

  SELECT COALESCE(MAX((regexp_match(intake_number, '[0-9]+$'))[1]::INTEGER), 0)
    INTO v_last_number
  FROM purchasing.vendor_documents
  WHERE intake_number LIKE v_prefix || '%';

  RETURN v_prefix || LPAD((v_last_number + 1)::TEXT, 4, '0');
END;
$function$;

-- public.get_unread_notification_count
CREATE OR REPLACE FUNCTION public.get_unread_notification_count(user_uuid uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  count integer;
BEGIN
  SELECT COUNT(*) INTO count
  FROM notifications
  WHERE user_id = user_uuid AND is_read = false;
  RETURN count;
END;
$function$;

-- public.get_user_brand
CREATE OR REPLACE FUNCTION public.get_user_brand()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT brand_id FROM configuration.users WHERE id = auth.uid();
$function$;

-- public.get_user_role
CREATE OR REPLACE FUNCTION public.get_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role FROM configuration.users WHERE id = auth.uid();
$function$;

-- public.initialize_employee_leave_balance
CREATE OR REPLACE FUNCTION public.initialize_employee_leave_balance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  join_year INTEGER;
  join_month INTEGER;
  pro_rated_leave INTEGER;
BEGIN
  join_year := EXTRACT(YEAR FROM NEW.join_date);
  join_month := EXTRACT(MONTH FROM NEW.join_date);
  pro_rated_leave := GREATEST(0, FLOOR(((12 - join_month)::DECIMAL / 12.0) * 12));
  INSERT INTO leave_balances (
    employee_id, year, annual_leave_total,
    annual_leave_used, sick_leave_used, unpaid_leave_used,
    maternity_leave_used, paternity_leave_used,
    emergency_leave_used, pilgrimage_leave_used, menstrual_leave_used
  ) VALUES (
    NEW.id, join_year, pro_rated_leave,
    0, 0, 0, 0, 0, 0, 0, 0
  ) ON CONFLICT (employee_id, year) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- public.is_hrd
CREATE OR REPLACE FUNCTION public.is_hrd()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM users WHERE id = auth.uid();
  RETURN COALESCE(v_role = 'hrd', false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$function$;

-- public.is_manager
CREATE OR REPLACE FUNCTION public.is_manager()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM users WHERE id = auth.uid();
  RETURN COALESCE(v_role IN ('hrd', 'hiring_manager'), false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$function$;

-- public.mark_notification_read
CREATE OR REPLACE FUNCTION public.mark_notification_read(notification_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE notifications
  SET is_read = true, read_at = now()
  WHERE id = notification_id;
END;
$function$;

-- public.notify_hrd
CREATE OR REPLACE FUNCTION public.notify_hrd(p_title text, p_message text, p_type text, p_link text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO notifications (user_id, title, message, type, link)
  SELECT id, p_title, p_message, p_type, p_link FROM users WHERE role = 'hrd';
EXCEPTION WHEN OTHERS THEN NULL;
END;
$function$;

-- public.notify_hrd_and_manager
CREATE OR REPLACE FUNCTION public.notify_hrd_and_manager(p_employee_id uuid, p_title text, p_message text, p_type text, p_link text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_manager_user_id uuid;
BEGIN
  -- Notify all HRD
  PERFORM notify_hrd(p_title, p_message, p_type, p_link);

  -- Notify manager jika ada (cari user_id dari reporting_to)
  SELECT u.user_id INTO v_manager_user_id
  FROM employees e
  JOIN employees m ON m.id = e.reporting_to
  LEFT JOIN employees u ON u.id = m.id
  WHERE e.id = p_employee_id
  LIMIT 1;

  IF v_manager_user_id IS NOT NULL THEN
    PERFORM notify_user(v_manager_user_id, p_title, p_message, p_type, p_link);
  END IF;
END;
$function$;

-- public.notify_user
CREATE OR REPLACE FUNCTION public.notify_user(p_user_id uuid, p_title text, p_message text, p_type text, p_link text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF p_user_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, title, message, type, link)
    VALUES (p_user_id, p_title, p_message, p_type, p_link);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$function$;

-- public.pos_calculate_xp_earned
CREATE OR REPLACE FUNCTION public.pos_calculate_xp_earned(p_order_total numeric, p_customer_tier text DEFAULT 'bronze'::text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  base_xp integer;
  tier_multiplier decimal(3,2);
BEGIN
  -- Base XP: 1 XP per Rp 10.000 (min 1 XP)
  base_xp := GREATEST(1, FLOOR(p_order_total / 10000)::integer);
  
  -- Tier multiplier
  tier_multiplier := CASE LOWER(p_customer_tier)
    WHEN 'platinum' THEN 2.00
    WHEN 'gold'     THEN 1.50
    WHEN 'silver'   THEN 1.25
    ELSE 1.00
  END;
  
  RETURN FLOOR(base_xp * tier_multiplier)::integer;
END;
$function$;

-- public.pos_cancel_split
CREATE OR REPLACE FUNCTION public.pos_cancel_split(p_split_id uuid, p_cashier_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_split RECORD;
  v_order_id UUID;
BEGIN
  SELECT * INTO v_split FROM pos_order_splits WHERE id = p_split_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Split not found');
  END IF;

  IF v_split.status IN ('paid', 'partial') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot cancel paid split');
  END IF;

  v_order_id := v_split.order_id;
  UPDATE pos_order_splits SET status = 'cancelled' WHERE id = p_split_id;

  INSERT INTO pos_order_status_history (order_id, status, reason)
  VALUES (v_order_id, 'split_cancelled', format('Split %s cancelled', v_split.label));

  RETURN jsonb_build_object('success', true, 'split_id', p_split_id);
END;
$function$;

-- public.pos_create_order_transaction
CREATE OR REPLACE FUNCTION public.pos_create_order_transaction(p_order_type text DEFAULT 'dine_in'::text, p_customer_id uuid DEFAULT NULL::uuid, p_cashier_id uuid DEFAULT NULL::uuid, p_server_id uuid DEFAULT NULL::uuid, p_table_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_special_requests text DEFAULT NULL::text, p_client_subtotal numeric DEFAULT 0, p_client_discount_amount numeric DEFAULT 0, p_client_tax_amount numeric DEFAULT 0, p_client_service_charge numeric DEFAULT 0, p_client_total_amount numeric DEFAULT 0, p_payment_method text DEFAULT 'cash'::text, p_amount_paid numeric DEFAULT 0, p_ark_coins_used numeric DEFAULT 0, p_membership_discount_pct numeric DEFAULT 0, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_order_id uuid;
  v_customer record;
  v_item record;
  v_product record;

  v_server_subtotal decimal(12,2) := 0;
  v_server_discount decimal(12,2) := 0;
  v_server_tax decimal(12,2) := 0;
  v_server_service_charge decimal(12,2) := 0;
  v_server_total decimal(12,2) := 0;
  v_server_change decimal(12,2) := 0;
  v_server_amount_paid decimal(12,2) := 0;

  v_xp_earned integer := 0;
  v_xp_current_before integer := 0;
  v_final_price decimal(12,2);
  v_item_subtotal decimal(12,2);
  v_paid_amount_check decimal(12,2);
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'p_items must be a JSON array');
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT id, membership_tier, total_xp, current_xp, visit_count, total_spent, ark_coin_balance
    INTO v_customer
    FROM pos_customers
    WHERE id = p_customer_id;

    IF v_customer IS NULL THEN
      RAISE EXCEPTION 'Customer % not found', p_customer_id;
    END IF;

    IF p_ark_coins_used > 0 AND v_customer.ark_coin_balance < p_ark_coins_used THEN
      RAISE EXCEPTION 'Insufficient Ark Coin balance. Available: %, Requested: %',
        v_customer.ark_coin_balance, p_ark_coins_used;
    END IF;
  END IF;

  FOR v_item IN
    SELECT
      (item ->> 'product_id')::uuid as product_id,
      (item ->> 'quantity')::decimal as quantity,
      COALESCE((item ->> 'unit_price')::decimal, 0) as unit_price,
      COALESCE((item ->> 'variant_price_adjustment')::decimal, 0) as var_adj,
      COALESCE((item ->> 'modifier_price_adjustment')::decimal, 0) as mod_adj
    FROM jsonb_array_elements(p_items) as item
  LOOP
    SELECT id, is_active, is_available, inventory_tracking
    INTO v_product
    FROM pos_products
    WHERE id = v_item.product_id;

    IF v_product IS NULL THEN
      RAISE EXCEPTION 'Product % not found', v_item.product_id;
    END IF;

    IF NOT v_product.is_active OR NOT v_product.is_available THEN
      RAISE EXCEPTION 'Product % is not available', v_item.product_id;
    END IF;

    IF v_product.inventory_tracking THEN
      PERFORM pos_validate_stock(v_item.product_id, v_item.quantity);
    END IF;

    v_final_price := v_item.unit_price + v_item.var_adj + v_item.mod_adj;
    v_item_subtotal := v_final_price * v_item.quantity;
    v_server_subtotal := v_server_subtotal + v_item_subtotal;
  END LOOP;

  IF p_membership_discount_pct > 0 THEN
    v_server_discount := ROUND(v_server_subtotal * p_membership_discount_pct / 100, 2);
  END IF;

  IF p_client_tax_amount > 0 THEN
    v_server_tax := ROUND((v_server_subtotal - v_server_discount) * 0.10, 2);
  END IF;

  v_server_service_charge := p_client_service_charge;
  v_server_total := v_server_subtotal - v_server_discount + v_server_tax + v_server_service_charge;

  IF ABS(v_server_total - p_client_total_amount) > 100 THEN
    RAISE EXCEPTION 'Total amount mismatch. Server: %, Client: %', v_server_total, p_client_total_amount;
  END IF;

  v_paid_amount_check := p_amount_paid + p_ark_coins_used;
  IF v_paid_amount_check < v_server_total THEN
    RAISE EXCEPTION 'Payment insufficient. Total: %, Paid: %', v_server_total, v_paid_amount_check;
  END IF;

  v_server_change := v_paid_amount_check - v_server_total;
  v_server_amount_paid := p_amount_paid;

  INSERT INTO pos_orders (
    order_number, order_type, status, payment_status,
    customer_id, cashier_id, server_id,
    subtotal, discount_amount, tax_amount, service_charge_amount,
    total_amount, amount_paid, change_amount,
    payment_method, ark_coins_used,
    notes, special_requests
  ) VALUES (
    generate_order_number(), p_order_type, 'pending', 'unpaid',
    p_customer_id, COALESCE(p_cashier_id, '00000000-0000-0000-0000-000000000001'::uuid), p_server_id,
    v_server_subtotal, v_server_discount, v_server_tax, v_server_service_charge,
    v_server_total, v_server_amount_paid, v_server_change,
    p_payment_method, p_ark_coins_used,
    p_notes, p_special_requests
  )
  RETURNING id INTO v_order_id;

  INSERT INTO pos_order_items (
    order_id, product_id, product_name, product_sku,
    variants, modifiers, quantity, unit_price,
    subtotal, discount_amount, total_amount, xp_earned
  )
  SELECT
    v_order_id,
    (item ->> 'product_id')::uuid,
    COALESCE(item ->> 'product_name', 'Unknown'),
    COALESCE(item ->> 'product_sku', ''),
    COALESCE(item -> 'variants', '[]'::jsonb),
    COALESCE(item -> 'modifiers', '[]'::jsonb),
    (item ->> 'quantity')::decimal,
    ((item ->> 'unit_price')::decimal
      + COALESCE((item ->> 'variant_price_adjustment')::decimal, 0)
      + COALESCE((item ->> 'modifier_price_adjustment')::decimal, 0)),
    (((item ->> 'unit_price')::decimal
      + COALESCE((item ->> 'variant_price_adjustment')::decimal, 0)
      + COALESCE((item ->> 'modifier_price_adjustment')::decimal, 0))
      * (item ->> 'quantity')::decimal),
    0,
    (((item ->> 'unit_price')::decimal
      + COALESCE((item ->> 'variant_price_adjustment')::decimal, 0)
      + COALESCE((item ->> 'modifier_price_adjustment')::decimal, 0))
      * (item ->> 'quantity')::decimal),
    0
  FROM jsonb_array_elements(p_items) as item;

  FOR v_item IN
    SELECT
      (item ->> 'product_id')::uuid as product_id,
      (item ->> 'quantity')::decimal as quantity
    FROM jsonb_array_elements(p_items) as item
  LOOP
    SELECT inventory_tracking INTO v_product
    FROM pos_products WHERE id = v_item.product_id;

    IF v_product.inventory_tracking THEN
      PERFORM pos_deduct_inventory(v_item.product_id, v_item.quantity, v_order_id);
    END IF;

    UPDATE pos_order_items
    SET inventory_deducted = true
    WHERE order_id = v_order_id AND product_id = v_item.product_id;
  END LOOP;

  INSERT INTO pos_order_status_history (
    order_id, from_status, to_status, changed_by, notes
  ) VALUES (
    v_order_id, NULL, 'pending',
    COALESCE(p_cashier_id, '00000000-0000-0000-0000-000000000001'::uuid),
    'Order created'
  );

  IF p_customer_id IS NOT NULL THEN
    v_xp_earned := pos_calculate_xp_earned(v_server_total, v_customer.membership_tier);
    v_xp_current_before := v_customer.current_xp;

    UPDATE pos_customers SET
      total_xp = total_xp + v_xp_earned,
      current_xp = current_xp + v_xp_earned,
      visit_count = visit_count + 1,
      total_spent = total_spent + v_server_total,
      last_visit = now(),
      updated_at = now()
    WHERE id = p_customer_id;

    INSERT INTO pos_xp_transactions (
      customer_id, order_id, xp_earned,
      balance_before, balance_after, description
    ) VALUES (
      p_customer_id, v_order_id, v_xp_earned,
      v_xp_current_before, v_xp_current_before + v_xp_earned,
      'XP dari order ' || v_order_id 
    );

    IF p_ark_coins_used > 0 THEN
      PERFORM update_ark_coin_balance(
        p_customer_id, -p_ark_coins_used, 'payment', v_order_id,
        'Payment for order ' || v_order_id
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', (
      SELECT order_number FROM pos_orders WHERE id = v_order_id
    ),
    'subtotal', v_server_subtotal,
    'discount_amount', v_server_discount,
    'tax_amount', v_server_tax,
    'total_amount', v_server_total,
    'change_amount', v_server_change,
    'ark_coins_used', p_ark_coins_used,
    'xp_earned', v_xp_earned,
    'total_paid', v_server_amount_paid + p_ark_coins_used,
    'payment_status', 'unpaid'
  );
END;
$function$;

-- public.pos_create_split_order_transaction
CREATE OR REPLACE FUNCTION public.pos_create_split_order_transaction(p_order_type text, p_cashier_id text, p_customer_id uuid DEFAULT NULL::uuid, p_server_id text DEFAULT NULL::text, p_table_id text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb, p_subtotal numeric DEFAULT 0, p_discount_amount numeric DEFAULT 0, p_discount_reason text DEFAULT NULL::text, p_tax_amount numeric DEFAULT 0, p_service_charge_amount numeric DEFAULT 0, p_total_amount numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_special_requests text DEFAULT NULL::text, p_splits jsonb DEFAULT '[]'::jsonb, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_order_id UUID;
  v_order_number TEXT;
  v_item JSONB;
  v_item_id UUID;
  v_item_ids UUID[];
  v_item_index INTEGER := 0;
  v_split JSONB;
  v_split_id UUID;
  v_split_index INTEGER := 0;
  v_sum_splits NUMERIC(12,2) := 0;
  v_mapping JSONB;
BEGIN
  IF p_splits IS NULL OR jsonb_typeof(p_splits) != 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_splits must be a JSON array',
      'got', COALESCE(p_splits::TEXT, 'NULL')
    );
  END IF;

  IF jsonb_array_length(p_splits) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'splits array cannot be empty for split bill'
    );
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_items must be a JSON array',
      'got', COALESCE(p_items::TEXT, 'NULL')
    );
  END IF;

  SELECT COALESCE(SUM((value ->> 'total_amount')::NUMERIC), 0)
  INTO v_sum_splits
  FROM jsonb_array_elements(p_splits);

  IF v_sum_splits != p_total_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Splits total (%.2f) does not match order total (%.2f)', v_sum_splits, p_total_amount)
    );
  END IF;

  v_order_number := generate_order_number();

  INSERT INTO pos_orders (
    order_number, order_type, status, payment_status,
    customer_id, cashier_id, server_id,
    subtotal, discount_amount, discount_reason,
    tax_amount, service_charge_amount, total_amount,
    amount_paid, change_amount, notes, special_requests,
    ordered_at
  ) VALUES (
    v_order_number, p_order_type, 'pending', 'unpaid',
    p_customer_id, p_cashier_id, p_server_id,
    p_subtotal, p_discount_amount, p_discount_reason,
    p_tax_amount, p_service_charge_amount, p_total_amount,
    0, 0, p_notes, p_special_requests, now()
  ) RETURNING id INTO v_order_id;

  v_item_ids := ARRAY[]::UUID[];

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO pos_order_items (
      order_id, product_id, product_name, product_sku,
      variant_info, modifier_info, quantity,
      unit_price, subtotal, total_amount, notes
    ) VALUES (
      v_order_id,
      (v_item ->> 'product_id')::UUID,
      v_item ->> 'product_name',
      v_item ->> 'product_sku',
      v_item ->> 'variant_info',
      v_item ->> 'modifier_info',
      (v_item ->> 'quantity')::INTEGER,
      (v_item ->> 'unit_price')::NUMERIC,
      (v_item ->> 'subtotal')::NUMERIC,
      (v_item ->> 'total_amount')::NUMERIC,
      v_item ->> 'notes'
    ) RETURNING id INTO v_item_id;

    v_item_ids := array_append(v_item_ids, v_item_id);
    v_item_index := v_item_index + 1;
  END LOOP;

  v_split_index := 0;

  FOR v_split IN SELECT * FROM jsonb_array_elements(p_splits)
  LOOP
    v_split_index := v_split_index + 1;
    INSERT INTO pos_order_splits (
      order_id, split_index, label,
      subtotal, tax_amount, discount_amount,
      total_amount, customer_id, status
    ) VALUES (
      v_order_id, v_split_index,
      COALESCE(v_split ->> 'label', 'Split ' || v_split_index),
      COALESCE((v_split ->> 'subtotal')::NUMERIC, 0),
      COALESCE((v_split ->> 'tax_amount')::NUMERIC, 0),
      COALESCE((v_split ->> 'discount_amount')::NUMERIC, 0),
      (v_split ->> 'total_amount')::NUMERIC,
      (v_split ->> 'customer_id')::UUID,
      'pending'
    ) RETURNING id INTO v_split_id;

    IF jsonb_typeof(v_split -> 'items') = 'array' THEN
      FOR v_mapping IN SELECT * FROM jsonb_array_elements(v_split -> 'items')
      LOOP
        DECLARE
          v_map_idx INTEGER;
          v_map_qty INTEGER;
        BEGIN
          v_map_idx := COALESCE((v_mapping ->> 'order_item_index')::INTEGER, -1);
          v_map_qty := COALESCE((v_mapping ->> 'quantity')::INTEGER, 1);

          IF v_map_idx >= 0 AND v_map_idx < COALESCE(array_length(v_item_ids, 1), 0) THEN
            INSERT INTO pos_order_split_items (
              split_id, order_item_id, quantity,
              subtotal, total_amount
            ) VALUES (
              v_split_id,
              v_item_ids[v_map_idx + 1],
              v_map_qty,
              COALESCE((v_mapping ->> 'unit_price')::NUMERIC, 0) * v_map_qty,
              COALESCE((v_mapping ->> 'unit_price')::NUMERIC, 0) * v_map_qty
            );
          END IF;
        END;
      END LOOP;
    END IF;
  END LOOP;

  INSERT INTO pos_order_status_history (order_id, status, reason)
  VALUES (v_order_id, 'pending', 'Split bill order created: ' || jsonb_array_length(p_splits) || ' bill(s)');

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'split_count', jsonb_array_length(p_splits)
  );
END;
$function$;

-- public.pos_deduct_inventory
CREATE OR REPLACE FUNCTION public.pos_deduct_inventory(p_product_id uuid, p_quantity numeric, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_recipe record;
  v_needed decimal(12,4);
  v_before decimal(12,4);
BEGIN
  FOR v_recipe IN
    SELECT raw_material_id, quantity_per_unit, unit_of_measure
    FROM pos_recipes
    WHERE product_id = p_product_id AND is_active = true
  LOOP
    v_needed := v_recipe.quantity_per_unit * p_quantity;
    
    SELECT current_stock INTO v_before
    FROM purchasing.raw_materials
    WHERE id = v_recipe.raw_material_id;
    
    -- Update stock
    UPDATE purchasing.raw_materials
    SET current_stock = COALESCE(current_stock, 0) - v_needed,
        updated_at = now()
    WHERE id = v_recipe.raw_material_id;
    
    -- Log inventory movement (if movement table exists)
    -- INSERT INTO purchasing.inventory_movements (...) VALUES (...);
  END LOOP;
  
  RETURN true;
END;
$function$;

-- public.pos_get_order_splits
CREATE OR REPLACE FUNCTION public.pos_get_order_splits(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT jsonb_build_object(
    'success', true,
    'splits', COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'label', s.label,
        'split_index', s.split_index,
        'total_amount', s.total_amount,
        'amount_paid', s.amount_paid,
        'change_amount', s.change_amount,
        'tax_amount', s.tax_amount,
        'discount_amount', s.discount_amount,
        'payment_method', s.payment_method,
        'status', s.status,
        'customer_id', s.customer_id,
        'ark_coins_used', s.ark_coins_used,
        'paid_at', s.paid_at,
        'created_at', s.created_at
      ) ORDER BY s.split_index
    ), '[]'::jsonb),
    'total_paid', (
      SELECT COALESCE(SUM(amount_paid), 0) FROM pos_order_splits WHERE order_id = p_order_id AND status = 'paid'
    ),
    'total_remaining', (
      SELECT COALESCE(SUM(total_amount), 0) - COALESCE(SUM(amount_paid), 0)
      FROM pos_order_splits
      WHERE order_id = p_order_id AND status != 'cancelled'
    ),
    'split_count', (SELECT COUNT(*) FROM pos_order_splits WHERE order_id = p_order_id),
    'paid_count', (SELECT COUNT(*) FROM pos_order_splits WHERE order_id = p_order_id AND status = 'paid')
  )
  FROM pos_order_splits s
  WHERE s.order_id = p_order_id;
$function$;

-- public.pos_is_table_available
CREATE OR REPLACE FUNCTION public.pos_is_table_available(p_table_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM pos_orders
    WHERE table_id = p_table_id
      AND status::TEXT IN ('pending', 'confirmed', 'preparing', 'ready', 'served')
  );
END;
$function$;

-- public.pos_merge_orders
CREATE OR REPLACE FUNCTION public.pos_merge_orders(p_source_order_id uuid, p_target_order_id uuid, p_supervisor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_source RECORD;
  v_target RECORD;
BEGIN
  IF p_source_order_id = p_target_order_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot merge order with itself');
  END IF;

  SELECT * INTO v_source FROM pos_orders WHERE id = p_source_order_id;
  SELECT * INTO v_target FROM pos_orders WHERE id = p_target_order_id;

  IF NOT FOUND(v_source) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source order not found');
  END IF;
  IF NOT FOUND(v_target) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target order not found');
  END IF;

  IF v_source.status::TEXT IN ('completed', 'cancelled', 'voided', 'merged') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source order cannot be merged');
  END IF;
  IF v_target.status::TEXT IN ('completed', 'cancelled', 'voided', 'merged') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target order cannot receive merge');
  END IF;

  -- Move items from source to target
  UPDATE pos_order_items SET order_id = p_target_order_id WHERE order_id = p_source_order_id;

  -- Recalculate target totals
  UPDATE pos_orders SET
    subtotal = COALESCE((SELECT SUM(subtotal) FROM pos_order_items WHERE order_id = p_target_order_id), 0),
    total_amount = COALESCE((SELECT SUM(total_amount) FROM pos_order_items WHERE order_id = p_target_order_id), 0),
    discount_amount = COALESCE(discount_amount, 0) + COALESCE(v_source.discount_amount, 0),
    tax_amount = COALESCE(tax_amount, 0) + COALESCE(v_source.tax_amount, 0),
    updated_at = NOW()
  WHERE id = p_target_order_id;

  -- Mark source as merged
  UPDATE pos_orders SET
    status = 'merged',
    merged_to_order_id = p_target_order_id,
    updated_at = NOW(),
    payment_status = 'refunded'
  WHERE id = p_source_order_id;

  -- Track merge history on target
  UPDATE pos_orders SET
    merged_from_orders = array_append(COALESCE(merged_from_orders, '{}'), p_source_order_id)
  WHERE id = p_target_order_id;

  -- Cancel any pending splits on source
  UPDATE pos_order_splits SET status = 'cancelled', updated_at = NOW()
  WHERE order_id = p_source_order_id AND status = 'pending';

  RETURN jsonb_build_object(
    'success', true,
    'source_order_id', p_source_order_id,
    'target_order_id', p_target_order_id,
    'message', 'Orders merged successfully'
  );
END;
$function$;

-- public.pos_move_order_table
CREATE OR REPLACE FUNCTION public.pos_move_order_table(p_order_id uuid, p_new_table_id text, p_new_order_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_order RECORD;
  v_table_available BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM pos_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found');
  END IF;

  IF v_order.status::TEXT IN ('completed', 'cancelled', 'voided', 'merged') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot move finished order');
  END IF;

  -- Check table availability if moving to a dine-in table
  IF p_new_table_id IS NOT NULL THEN
    v_table_available := pos_is_table_available(p_new_table_id);
    IF NOT v_table_available THEN
      RETURN jsonb_build_object('success', false, 'error', 'Table is occupied');
    END IF;
  END IF;

  UPDATE pos_orders SET
    table_id = p_new_table_id,
    order_type = COALESCE(p_new_order_type, v_order.order_type),
    updated_at = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'new_table_id', p_new_table_id,
    'new_order_type', COALESCE(p_new_order_type, v_order.order_type),
    'message', 'Order moved successfully'
  );
END;
$function$;

-- public.pos_pay_split_transaction
CREATE OR REPLACE FUNCTION public.pos_pay_split_transaction(p_split_id uuid, p_payment_method text, p_amount_paid numeric, p_ark_coins_used numeric DEFAULT 0, p_cashier_id text DEFAULT 'system'::text, p_reference_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_split_record RECORD;
  v_order_id UUID;
  v_customer_id UUID;
  v_cust_balance NUMERIC(12,2);
  v_change NUMERIC(12,2);
  v_all_paid_count INTEGER;
  v_total_splits INTEGER;
BEGIN
  SELECT s.* INTO v_split_record
  FROM pos_order_splits s
  WHERE s.id = p_split_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Split not found');
  END IF;

  IF v_split_record.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Split already cancelled');
  END IF;

  IF v_split_record.status = 'paid' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Split already paid');
  END IF;

  v_order_id := v_split_record.order_id;

  IF p_amount_paid < v_split_record.total_amount THEN
    RETURN jsonb_build_object('success', false, 'error', format('Amount paid %.0f is less than split total %.0f', p_amount_paid, v_split_record.total_amount));
  END IF;

  v_change := p_amount_paid - v_split_record.total_amount;
  v_customer_id := v_split_record.customer_id;

  IF p_ark_coins_used > 0 THEN
    IF v_customer_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot use ARK Coin without member customer');
    END IF;

    PERFORM id FROM pos_customers WHERE id = v_customer_id FOR UPDATE;

    SELECT ark_coin_balance INTO v_cust_balance FROM pos_customers WHERE id = v_customer_id;
    IF v_cust_balance < p_ark_coins_used THEN
      RETURN jsonb_build_object('success', false, 'error', format('ARK Coin balance insufficient: %.0f needed, %.0f available', p_ark_coins_used, v_cust_balance));
    END IF;

    UPDATE pos_customers
    SET ark_coin_balance = ark_coin_balance - p_ark_coins_used
    WHERE id = v_customer_id;
  END IF;

  INSERT INTO pos_split_payments (split_id, order_id, amount, change_amount, payment_method, reference_number, cashier_id)
  VALUES (p_split_id, v_order_id, p_amount_paid, v_change, p_payment_method, p_reference_number, p_cashier_id);

  UPDATE pos_order_splits
  SET status = 'paid',
      payment_method = p_payment_method,
      amount_paid = p_amount_paid,
      change_amount = v_change,
      ark_coins_used = p_ark_coins_used,
      paid_at = now()
  WHERE id = p_split_id;

  SELECT COUNT(*) INTO v_total_splits FROM pos_order_splits WHERE order_id = v_order_id;
  SELECT COUNT(*) INTO v_all_paid_count FROM pos_order_splits WHERE order_id = v_order_id AND status = 'paid';

  IF v_all_paid_count = v_total_splits THEN
    UPDATE pos_orders
    SET payment_status = 'paid', completed_at = now()
    WHERE id = v_order_id;
  ELSIF v_all_paid_count >= 1 THEN
    UPDATE pos_orders
    SET payment_status = 'partial'
    WHERE id = v_order_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'split_id', p_split_id, 'change', v_change, 'paid_splits', v_all_paid_count, 'total_splits', v_total_splits);
END;
$function$;

-- public.pos_update_shift_totals
CREATE OR REPLACE FUNCTION public.pos_update_shift_totals()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_shift_id UUID;
  v_total_orders INTEGER;
  v_total_sales NUMERIC(12,2);
  v_total_cash NUMERIC(12,2);
  v_total_qris NUMERIC(12,2);
  v_total_debit NUMERIC(12,2);
  v_total_credit NUMERIC(12,2);
  v_total_ark NUMERIC(12,2);
  v_expected NUMERIC(12,2);
BEGIN
  v_shift_id := NEW.shift_id;

  IF v_shift_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('completed','served') AND NEW.payment_status NOT IN ('paid','partial') THEN
    RETURN NEW;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(total_amount), 0),
    COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount_paid ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_method = 'qris' THEN total_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_method = 'debit' THEN total_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_method = 'credit' THEN total_amount ELSE 0 END), 0),
    COALESCE(SUM(ark_coins_used), 0)
  INTO
    v_total_orders, v_total_sales,
    v_total_cash, v_total_qris,
    v_total_debit, v_total_credit, v_total_ark
  FROM pos_orders
  WHERE shift_id = v_shift_id;

  SELECT COALESCE(opening_cash, 0) + v_total_cash
  INTO v_expected
  FROM pos_shifts
  WHERE id = v_shift_id;

  UPDATE pos_shifts SET
    total_orders = v_total_orders,
    total_sales = v_total_sales,
    total_cash_sales = v_total_cash,
    total_qris_sales = v_total_qris,
    total_debit_sales = v_total_debit,
    total_credit_sales = v_total_credit,
    total_ark_coin_sales = v_total_ark,
    expected_cash = v_expected,
    updated_at = NOW()
  WHERE id = v_shift_id;

  RETURN NEW;
END;
$function$;

-- public.pos_validate_stock
CREATE OR REPLACE FUNCTION public.pos_validate_stock(p_product_id uuid, p_quantity numeric)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_recipe record;
  v_needed decimal(12,4);
  v_current decimal(12,4);
  v_allow_negative boolean;
BEGIN
  -- Check if product tracks inventory
  SELECT COALESCE(ps.allow_negative_stock, true)
  INTO v_allow_negative
  FROM pos_inventory_settings ps
  WHERE ps.product_id = p_product_id;
  
  -- If no inventory tracking or allow_negative, skip validation
  IF v_allow_negative IS NULL OR v_allow_negative = true THEN
    RETURN true;
  END IF;
  
  -- Check all raw materials in recipe
  FOR v_recipe IN
    SELECT raw_material_id, quantity_per_unit, unit_of_measure
    FROM pos_recipes
    WHERE product_id = p_product_id AND is_active = true
  LOOP
    v_needed := v_recipe.quantity_per_unit * p_quantity;
    
    -- Get current stock from purchasing.raw_materials
    SELECT COALESCE(current_stock, 0)
    INTO v_current
    FROM purchasing.raw_materials
    WHERE id = v_recipe.raw_material_id;
    
    IF v_current IS NULL OR v_current < v_needed THEN
      RAISE EXCEPTION 'Insufficient stock for raw_material_id %. Required: % %, Available: %',
        v_recipe.raw_material_id, v_needed, v_recipe.unit_of_measure, COALESCE(v_current, 0);
    END IF;
  END LOOP;
  
  RETURN true;
END;
$function$;

-- public.pos_validate_supervisor_pin
CREATE OR REPLACE FUNCTION public.pos_validate_supervisor_pin(p_pin text)
 RETURNS TABLE(user_id uuid, full_name text, role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT u.id, u.full_name, u.role
  FROM users u
  WHERE u.role = 'pos_supervisor'
    AND u.pos_pin = p_pin
  LIMIT 1;
END;
$function$;

-- public.pos_void_order
CREATE OR REPLACE FUNCTION public.pos_void_order(p_order_id uuid, p_reason text, p_supervisor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_order RECORD;
BEGIN
  SELECT * INTO v_order FROM pos_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found');
  END IF;

  IF v_order.status::TEXT = 'voided' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order already voided');
  END IF;

  IF v_order.status::TEXT = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot void completed order');
  END IF;

  IF v_order.status::TEXT = 'merged' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot void merged order');
  END IF;

  UPDATE pos_orders SET
    status = 'voided',
    voided_at = NOW(),
    voided_by = p_supervisor_id,
    void_reason = p_reason,
    updated_at = NOW()
  WHERE id = p_order_id;

  -- If order was split, mark remaining unpaid splits as cancelled
  UPDATE pos_order_splits SET
    status = 'cancelled',
    updated_at = NOW()
  WHERE order_id = p_order_id AND status = 'pending';

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'message', 'Order voided successfully'
  );
END;
$function$;

-- public.process_return_approval
CREATE OR REPLACE FUNCTION public.process_return_approval()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Only process when status changes to 'approved'
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    -- Update GRN items qty_returned
    UPDATE grn_items gi
    SET qty_returned = qty_returned + pri.qty_returned
    FROM purchase_return_items pri
    WHERE pri.return_id = NEW.id
      AND gi.id = pri.grn_item_id;
    
    -- Create inventory OUT movements
    INSERT INTO inventory_movements (
      raw_material_id,
      movement_type,
      qty,
      reference_id,
      reference_type,
      notes,
      created_by
    )
    SELECT 
      pri.raw_material_id,
      'RETURN_OUT',
      -pri.qty_returned,
      NEW.id,
      'purchase_return',
      'Return to supplier: ' || NEW.return_number || ' - ' || COALESCE(pri.condition_notes, ''),
      NEW.approved_by
    FROM purchase_return_items pri
    WHERE pri.return_id = NEW.id;
    
    -- Update raw_materials stock
    UPDATE raw_materials rm
    SET qty_onhand = qty_onhand - (
      SELECT COALESCE(SUM(pri.qty_returned), 0)
      FROM purchase_return_items pri
      WHERE pri.return_id = NEW.id AND pri.raw_material_id = rm.id
    )
    WHERE EXISTS (
      SELECT 1 FROM purchase_return_items pri
      WHERE pri.return_id = NEW.id AND pri.raw_material_id = rm.id
    );
  END IF;
  
  RETURN NEW;
END;
$function$;

-- public.promote_candidate_to_employee
CREATE OR REPLACE FUNCTION public.promote_candidate_to_employee(p_candidate_id uuid, p_join_date date, p_employment_status character varying, p_department_id uuid, p_job_title_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_employee_id uuid;
  v_candidate record;
BEGIN
  SELECT * INTO v_candidate FROM candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate not found';
  END IF;

  INSERT INTO employees (
    full_name, email, phone, join_date,
    employment_status, department_id, job_title_id
  ) VALUES (
    v_candidate.name, v_candidate.email, COALESCE(v_candidate.phone, ''),
    p_join_date, p_employment_status, p_department_id, p_job_title_id
  ) RETURNING id INTO v_employee_id;

  RETURN v_employee_id;
END;
$function$;

-- public.recalculate_purchase_order_payment_term
CREATE OR REPLACE FUNCTION public.recalculate_purchase_order_payment_term(p_term_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_amount NUMERIC(15,2);
  v_paid NUMERIC(15,2);
  v_due DATE;
BEGIN
  IF p_term_id IS NULL THEN
    RETURN;
  END IF;

  SELECT amount, due_date
  INTO v_amount, v_due
  FROM purchasing.purchase_order_payment_terms
  WHERE id = p_term_id
    AND is_active = TRUE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_paid
  FROM purchasing.vendor_payments
  WHERE payment_term_id = p_term_id
    AND status = 'posted';

  UPDATE purchasing.purchase_order_payment_terms
  SET paid_amount = v_paid,
      status = CASE
        WHEN v_paid >= v_amount THEN 'paid'
        WHEN v_paid > 0 THEN 'partial'
        WHEN v_due < CURRENT_DATE THEN 'overdue'
        ELSE 'unpaid'
      END,
      updated_at = NOW()
  WHERE id = p_term_id;
END;
$function$;

-- public.rls_auto_enable
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- public.set_employee_nip
CREATE OR REPLACE FUNCTION public.set_employee_nip()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.nip IS NULL OR NEW.nip = '' THEN
    NEW.nip := generate_nip();
  END IF;
  RETURN NEW;
END;
$function$;

-- public.set_vendor_document_intake_number
CREATE OR REPLACE FUNCTION public.set_vendor_document_intake_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.intake_number IS NULL OR NEW.intake_number = '' THEN
    NEW.intake_number := public.generate_vendor_document_intake_number();
  END IF;

  RETURN NEW;
END;
$function$;

-- public.set_vendor_documents_updated_at
CREATE OR REPLACE FUNCTION public.set_vendor_documents_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- public.sync_purchase_order_payment_term
CREATE OR REPLACE FUNCTION public.sync_purchase_order_payment_term()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.recalculate_purchase_order_payment_term(NEW.payment_term_id);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.recalculate_purchase_order_payment_term(OLD.payment_term_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- public.trg_lock_summary_on_approval
CREATE OR REPLACE FUNCTION public.trg_lock_summary_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- When assignment is approved, lock the summary
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    UPDATE feedback_summaries fs
    SET 
      is_locked = true,
      locked_at = NOW(),
      locked_by = NEW.approved_by
    WHERE 
      fs.employee_id = NEW.employee_id
      AND fs.cycle_id = NEW.cycle_id;
  END IF;
  
  -- If rejected, reset summary lock
  IF NEW.status = 'rejected' AND OLD.status != 'rejected' THEN
    UPDATE feedback_summaries fs
    SET 
      is_locked = false,
      locked_at = NULL,
      locked_by = NULL
    WHERE 
      fs.employee_id = NEW.employee_id
      AND fs.cycle_id = NEW.cycle_id;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- public.trg_update_hris_logbook_score
CREATE OR REPLACE FUNCTION public.trg_update_hris_logbook_score()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM update_hris_logbook_entry_score(COALESCE(NEW.entry_id, OLD.entry_id));
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- public.update_ark_coin_balance
CREATE OR REPLACE FUNCTION public.update_ark_coin_balance(p_customer_id uuid, p_amount numeric, p_type text DEFAULT 'payment'::text, p_order_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_balance_before decimal(12,2);
  v_balance_after decimal(12,2);
BEGIN
  -- Lock row for update to prevent race conditions
  SELECT ark_coin_balance INTO v_balance_before
  FROM pos_customers
  WHERE id = p_customer_id
  FOR UPDATE;
  
  IF v_balance_before IS NULL THEN
    RAISE EXCEPTION 'Customer % not found', p_customer_id;
  END IF;
  
  v_balance_after := v_balance_before + p_amount;
  
  -- Prevent negative balance on payment
  IF p_type = 'payment' AND v_balance_after < 0 THEN
    RAISE EXCEPTION 'Insufficient Ark Coin balance. Available: %, Required: %', v_balance_before, ABS(p_amount);
  END IF;
  
  -- Update customer balance
  UPDATE pos_customers
  SET ark_coin_balance = v_balance_after,
      updated_at = now()
  WHERE id = p_customer_id;
  
  -- Log transaction
  INSERT INTO pos_wallet_transactions (
    customer_id, type, amount, ark_coins, 
    balance_before, balance_after, order_id, notes
  ) VALUES (
    p_customer_id, p_type, ABS(p_amount), ABS(p_amount),
    v_balance_before, v_balance_after, p_order_id, COALESCE(p_notes, p_type)
  );
  
  RETURN v_balance_after;
END;
$function$;

-- public.update_employee_offboarding_status
CREATE OR REPLACE FUNCTION public.update_employee_offboarding_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Update employee status to resigned
    UPDATE employees
    SET 
      employment_status = 'resigned',
      is_active = false,
      end_date = NEW.last_working_day,
      updated_at = NOW()
    WHERE id = NEW.employee_id;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- public.update_employees_updated_at
CREATE OR REPLACE FUNCTION public.update_employees_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- public.update_grn_updated_at
CREATE OR REPLACE FUNCTION public.update_grn_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

-- public.update_hris_logbook_entry_score
CREATE OR REPLACE FUNCTION public.update_hris_logbook_entry_score(p_entry_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  total_weight NUMERIC;
  checked_weight NUMERIC;
  total_items INTEGER;
  checked_items INTEGER;
BEGIN
  SELECT
    COALESCE(SUM(weight), 0),
    COALESCE(SUM(CASE WHEN is_checked THEN weight ELSE 0 END), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE is_checked)
  INTO total_weight, checked_weight, total_items, checked_items
  FROM hris_logbook_entry_items
  WHERE entry_id = p_entry_id;

  UPDATE hris_logbook_entries
  SET
    completion_percentage = CASE WHEN total_items = 0 THEN 0 ELSE ROUND((checked_items::NUMERIC / total_items::NUMERIC) * 100, 2) END,
    kpi_score = CASE WHEN total_weight = 0 THEN 0 ELSE ROUND((checked_weight / total_weight) * 100, 2) END,
    updated_at = NOW()
  WHERE id = p_entry_id;
END;
$function$;

-- public.update_hris_updated_at
CREATE OR REPLACE FUNCTION public.update_hris_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- public.update_job_openings_updated_at
CREATE OR REPLACE FUNCTION public.update_job_openings_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at = NOW();
  END IF;
  RETURN NEW;
END;
$function$;

-- public.update_po_status_on_receive
CREATE OR REPLACE FUNCTION public.update_po_status_on_receive()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    total_ordered DECIMAL(12,4);
    total_received DECIMAL(12,4);
    po_status VARCHAR(20);
BEGIN
    SELECT status INTO po_status
    FROM purchase_orders
    WHERE id = NEW.purchase_order_id;

    IF po_status = 'cancelled' THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(SUM(qty_ordered), 0), COALESCE(SUM(qty_received), 0)
    INTO total_ordered, total_received
    FROM purchase_order_items
    WHERE purchase_order_id = NEW.purchase_order_id AND is_active = TRUE;

    IF total_received >= total_ordered THEN
        UPDATE purchase_orders
        SET status = 'received',
            updated_at = NOW()
        WHERE id = NEW.purchase_order_id;
    ELSIF total_received > 0 THEN
        UPDATE purchase_orders
        SET status = 'partially_received',
            updated_at = NOW()
        WHERE id = NEW.purchase_order_id;
    END IF;

    RETURN NEW;
END;
$function$;

-- public.update_staff_updated_at
CREATE OR REPLACE FUNCTION public.update_staff_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- public.update_updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

-- public.update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

