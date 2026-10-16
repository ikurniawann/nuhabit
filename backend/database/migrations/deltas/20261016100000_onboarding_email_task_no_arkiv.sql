-- New employees got an onboarding task "Aktivasi email @arkiv.co.id", the
-- domain of the codebase's old Arkiv name. The task now names no domain;
-- the function is otherwise unchanged from bootstrap. Existing tasks with
-- the old text are renamed too.

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
  (NEW.id, 'Setup Email Perusahaan', 'it', 'Aktivasi email perusahaan', v_join_date + INTERVAL '1 day', 1, 1),
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

UPDATE hris.onboarding_checklists
SET description = 'Aktivasi email perusahaan'
WHERE description = 'Aktivasi email @arkiv.co.id';
