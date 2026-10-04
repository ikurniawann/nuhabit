-- fn_notify_offboarding_changes resolved its CASE to the offboarding_status
-- enum (ELSE NEW.status), so every label ('Selesai', 'Diajukan', …) was cast
-- to the enum and any status change failed with 22P02. Both the TS route and
-- the Go port of PUT /api/hris/offboarding/[employee_id] hit it; compare as
-- text instead.
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
        CASE NEW.status::text
          WHEN 'submitted'      THEN 'Diajukan'
          WHEN 'notice_period'  THEN 'Masa Pemberitahuan'
          WHEN 'exit_interview' THEN 'Exit Interview'
          WHEN 'completed'      THEN 'Selesai'
          ELSE NEW.status::text
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
