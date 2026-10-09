-- Earlier payslip_sent values came from opening a WhatsApp link and do not
-- prove an email was sent. Track email delivery separately.
ALTER TABLE hris.payroll_details
ADD COLUMN IF NOT EXISTS payslip_emailed_at timestamptz,
ADD COLUMN IF NOT EXISTS payslip_email_recipient text,
ADD COLUMN IF NOT EXISTS payslip_resend_id text;
