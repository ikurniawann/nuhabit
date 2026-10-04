// ============================================================
// API Route: Employment History
// GET: Get employment history for an employee
// POST: Add history record (promotion, transfer, etc.)
//
// Keamanan: GET boleh pengelola karyawan atau karyawan itu sendiri;
// POST khusus menu kepegawaian.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { requireEmployeeAccess } from "@/lib/hris/employee-access";
import { IAM } from "@/lib/iam/prefixes";

export async function GET(request: NextRequest) {
  try {
    const employee_id = request.nextUrl.searchParams.get('employee_id');

    if (!employee_id) {
      return NextResponse.json({ error: 'employee_id diperlukan' }, { status: 400 });
    }
    await requireEmployeeAccess(employee_id);
    const db = await createServerPgClient();

    const { data, error } = await db
      .from('employment_history')
      .select(`
        *,
        prev_department:departments!prev_department_id (id, name),
        new_department:departments!new_department_id (id, name),
        prev_section:sections!prev_section_id (id, name),
        new_section:sections!new_section_id (id, name),
        prev_job_title:positions!prev_job_title_id (id, title),
        new_job_title:positions!new_job_title_id (id, title)
      `)
      .eq('employee_id', employee_id)
      .order('effective_date', { ascending: false });

    if (error) {
      console.error('Error fetching employment history:', error);
      return NextResponse.json({ error: 'Gagal mengambil riwayat kerja' }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in employment history GET:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const db = await createServerPgClient();
    const body = await request.json();

    const {
      employee_id, change_type, effective_date,
      prev_department_id, prev_section_id, prev_job_title_id, prev_employment_status, prev_salary,
      new_department_id, new_section_id, new_job_title_id, new_employment_status, new_salary,
      reason, notes
    } = body;

    if (!employee_id || !change_type || !effective_date) {
      return NextResponse.json(
        { error: 'Field wajib: employee_id, change_type, effective_date' },
        { status: 400 }
      );
    }

    const { data, error } = await db
      .from('employment_history')
      .insert({
        employee_id, change_type, effective_date,
        prev_department_id: prev_department_id || null,
        prev_section_id: prev_section_id || null,
        prev_job_title_id: prev_job_title_id || null,
        prev_employment_status: prev_employment_status || null,
        prev_salary: prev_salary || null,
        new_department_id: new_department_id || null,
        new_section_id: new_section_id || null,
        new_job_title_id: new_job_title_id || null,
        new_employment_status: new_employment_status || null,
        new_salary: new_salary || null,
        reason: reason || null,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating employment history:', error);
      return NextResponse.json({ error: 'Gagal menyimpan riwayat kerja', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ data, message: 'Riwayat kerja berhasil disimpan' }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in employment history POST:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server' }, { status: 500 });
  }
}
