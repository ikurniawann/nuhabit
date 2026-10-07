-- Make interviewer_id nullable in interviews table
ALTER TABLE interviews ALTER COLUMN interviewer_id DROP NOT NULL;
