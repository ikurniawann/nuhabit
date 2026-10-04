// ============================================================
// API Route: Employee by ID
// GET: Get employee detail
// PUT: Update employee
// DELETE: Soft delete employee
//
// Keamanan: GET boleh pengelola karyawan atau karyawan itu sendiri (ESS);
// PUT/DELETE hanya pengelola. PUT memakai allowlist Zod, bukan spread body.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { EMPLOYEE_RECORD_MANAGERS, requireEmployeeAccess } from "@/lib/hris/employee-access";
import { employeeUpdateSchema } from "@/lib/hris/employee-update-schema";
import { Employee, ApiResponse } from '@/types/hris';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ============================================================
// GET /api/hris/employees/[id]
// ============================================================

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireEmployeeAccess(id);
    const db = createPgClient();

    const { data, error } = await db
      .from('employees')
      .select(`
        *,
        department:departments (id, name, code, description),
        section:sections (id, name, code, color),
        job_title:positions (id, title, department, level),
        direct_reports:employees!reporting_to (id, full_name, nip)
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Karyawan tidak ditemukan' },
          { status: 404 }
        );
      }
      console.error('Error fetching employee:', error);
      return NextResponse.json(
        { error: 'Gagal mengambil data karyawan' },
        { status: 500 }
      );
    }

    // Fetch manager separately to avoid self-referential join ambiguity
    let manager = null;
    if (data.reporting_to) {
      const { data: managerData } = await db
        .from('employees')
        .select('id, full_name, nip')
        .eq('id', data.reporting_to)
        .single();
      manager = managerData;
    }

    return NextResponse.json({
      data: { ...data, manager } as Employee
    } as ApiResponse<Employee>);

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in employee API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}

// ============================================================
// PUT /api/hris/employees/[id]
// ============================================================

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(EMPLOYEE_RECORD_MANAGERS);
    const db = createPgClient();
    const { id } = await params;
    const parsed = employeeUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Data karyawan tidak valid' }, { status: 400 });
    }
    const body = parsed.data;

    // Check if employee exists
    const { data: existing } = await db
      .from('employees')
      .select('id')
      .eq('id', id)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: 'Karyawan tidak ditemukan' },
        { status: 404 }
      );
    }

    // Check if email already exists (excluding current employee)
    if (body.email) {
      const { data: existingEmail } = await db
        .from('employees')
        .select('id')
        .eq('email', body.email)
        .neq('id', id)
        .single();

      if (existingEmail) {
        return NextResponse.json(
          { error: 'Email sudah digunakan' },
          { status: 400 }
        );
      }
    }

    // Check if NIP already exists (excluding current employee)
    if (body.nip) {
      const { data: existingNip } = await db
        .from('employees')
        .select('id')
        .eq('nip', body.nip)
        .neq('id', id)
        .single();

      if (existingNip) {
        return NextResponse.json(
          { error: 'NIP sudah digunakan' },
          { status: 400 }
        );
      }
    }

    // Get current employee data for comparison
    const { data: currentData } = await db
      .from('employees')
      .select('employment_status, department_id, section_id, job_title_id')
      .eq('id', id)
      .single();

    // Update employee — keep phone as '' if null to satisfy NOT NULL constraint
    const updateData = {
      ...body,
      ...('phone' in body ? { phone: body.phone || '' } : {}),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await db
      .from('employees')
      .update(updateData)
      .eq('id', id)
      .select('*, department:departments(id, name, code), section:sections(id, name), job_title:positions(id, title)')
      .single();

    if (error) {
      console.error('Error updating employee:', error);
      return NextResponse.json(
        { error: 'Gagal update data karyawan', details: error.message },
        { status: 500 }
      );
    }

    // Create employment history record if there are changes
    if (currentData) {
      const changes: string[] = [];
      let hasChanges = false;

      // Hanya field yang dikirim yang dibandingkan: PUT parsial tidak
      // boleh tercatat sebagai perubahan departemen/jabatan.
      type TrackedKey = 'employment_status' | 'department_id' | 'section_id' | 'job_title_id';
      const after = (key: TrackedKey) => (key in body ? body[key] : currentData[key]);
      const changed = (key: TrackedKey) => currentData[key] !== after(key);
      if (changed('employment_status')) {
        changes.push(`Status: ${currentData.employment_status} → ${after('employment_status')}`);
        hasChanges = true;
      }
      if (changed('department_id')) {
        changes.push(`Departemen berubah`);
        hasChanges = true;
      }
      if (changed('section_id')) {
        changes.push(`Seksi berubah`);
        hasChanges = true;
      }
      if (changed('job_title_id')) {
        changes.push(`Jabatan berubah`);
        hasChanges = true;
      }

      if (hasChanges) {
        const { error: historyError } = await db
          .from('employment_history')
          .insert({
            employee_id: id,
            change_type: 'status_change',
            notes: changes.join(', '),
            prev_employment_status: currentData.employment_status,
            new_employment_status: after('employment_status'),
            prev_department_id: currentData.department_id,
            new_department_id: after('department_id'),
            prev_section_id: currentData.section_id,
            new_section_id: after('section_id'),
            prev_job_title_id: currentData.job_title_id,
            new_job_title_id: after('job_title_id'),
            effective_date: new Date().toISOString().split('T')[0],
          });
        if (historyError) {
          console.error('Error inserting employment history:', historyError);
        }
      }
    }

    // Fetch manager separately
    let manager = null;
    if (data.reporting_to) {
      const { data: managerData } = await db
        .from('employees')
        .select('id, full_name, nip')
        .eq('id', data.reporting_to)
        .single();
      manager = managerData;
    }

    return NextResponse.json({
      data: { ...data, manager } as Employee,
      message: 'Data karyawan berhasil diupdate'
    } as ApiResponse<Employee>);

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in employee API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}

// ============================================================
// DELETE /api/hris/employees/[id]
// Soft delete: set is_active = false
// ============================================================

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(EMPLOYEE_RECORD_MANAGERS);
    const db = createPgClient();
    const { id } = await params;

    // Check if employee exists
    const { data: existing } = await db
      .from('employees')
      .select('id, is_active')
      .eq('id', id)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: 'Karyawan tidak ditemukan' },
        { status: 404 }
      );
    }

    // Soft delete: set is_active = false
    const { data, error } = await db
      .from('employees')
      .update({ 
        is_active: false,
        end_date: new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('id, full_name, nip, is_active')
      .single();

    if (error) {
      console.error('Error deleting employee:', error);
      return NextResponse.json(
        { error: 'Gagal menghapus data karyawan' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: data as Employee,
      message: 'Karyawan berhasil dihapus (non-aktif)'
    } as ApiResponse<Employee>);

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in employee API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}
