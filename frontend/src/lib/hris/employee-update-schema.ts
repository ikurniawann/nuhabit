import { z } from "zod";

const text = (max: number) => z.string().max(max).optional().nullable();
const uuid = z.string().uuid().optional().nullable();

/**
 * Kolom hris.employees yang BOLEH diubah lewat PUT /api/hris/employees/[id].
 * Allowlist (bukan spread body mentah): user_id, is_access_app,
 * old_staff_id, created_at, dan kolom lain di luar daftar ini dibuang,
 * jadi tautan akun login tidak bisa dibajak lewat body.
 */
export const employeeUpdateSchema = z
  .object({
    nip: text(50),
    full_name: z.string().trim().min(1).max(255).optional(),
    email: z.string().email().max(255).optional(),
    phone: text(50),
    join_date: text(10),
    end_date: text(10),
    employment_status: z.string().max(50).optional(),
    is_active: z.boolean().optional(),
    department_id: uuid,
    section_id: uuid,
    job_title_id: uuid,
    reporting_to: uuid,
    ktp: text(32),
    npwp: text(32),
    birth_date: text(10),
    gender: text(20),
    marital_status: text(20),
    address: text(1000),
    city: text(120),
    province: text(120),
    postal_code: text(10),
    bank_name: text(120),
    bank_account: text(64),
    bpjs_tk: text(64),
    bpjs_kesehatan: text(64),
    emergency_contact_name: text(255),
    emergency_contact_phone: text(50),
    emergency_contact_relationship: text(100),
    photo_url: text(1000),
    notes: text(5000),
  })
  .strip();

export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
