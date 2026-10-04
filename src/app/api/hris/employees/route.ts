// ============================================================
// API Route: Employees
// GET: List employees dengan filter & pagination
// POST: Create new employee
//
// Keamanan: GET hanya untuk pembaca direktori karyawan dan hanya kolom
// non-pribadi (tanpa KTP, NPWP, rekening, BPJS, alamat, kontak darurat);
// record lengkap lewat GET /api/hris/employees/[id]. POST khusus pengelola.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import {
  EMPLOYEE_DIRECTORY_READERS,
  EMPLOYEE_RECORD_MANAGERS,
} from "@/lib/hris/employee-access";
import { Employee, EmployeeCreateData, ApiResponse, PaginatedResponse } from '@/types/hris';

const DIRECTORY_COLUMNS = `id, user_id, full_name, nip, email, phone, photo_url,
  join_date, end_date, employment_status, is_active, is_access_app,
  department_id, section_id, job_title_id, reporting_to, created_at, updated_at`;

const SORTABLE = new Set(['full_name', 'nip', 'email', 'join_date', 'employment_status', 'created_at']);
const MAX_LIMIT = 500;

// ============================================================
// GET /api/hris/employees
// Query params: search, department_id, employment_status, is_active, page, limit, sort_by, sort_order
// ============================================================

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(EMPLOYEE_DIRECTORY_READERS);
    const db = createPgClient();

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    // Koma/kurung memecah ekspresi .or(), jadi dibuang supaya search tidak
    // bisa menyisipkan filter ke kolom lain.
    const search = searchParams.get('search')?.replace(/[,()]/g, ' ').trim();
    const department_id = searchParams.get('department_id');
    const section_id = searchParams.get('section_id');
    const employment_status = searchParams.get('employment_status');
    const is_active = searchParams.get('is_active');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') || '20') || 20));
    const requestedSort = searchParams.get('sort_by') || 'full_name';
    const sort_by = SORTABLE.has(requestedSort) ? requestedSort : 'full_name';
    const sort_order = searchParams.get('sort_order') || 'asc';

    // Build query
    let query = db
      .from('employees')
      .select(`
        ${DIRECTORY_COLUMNS},
        department:departments (
          id,
          name,
          code
        ),
        section:sections (
          id,
          name,
          code
        ),
        job_title:positions (
          id,
          title,
          department
        ),
        manager:employees!reporting_to (
          id,
          full_name,
          nip
        )
      `, { count: 'exact' });

    // Apply filters
    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,nip.ilike.%${search}%`);
    }

    if (department_id) {
      query = query.eq('department_id', department_id);
    }

    if (section_id) {
      query = query.eq('section_id', section_id);
    }

    if (employment_status) {
      query = query.eq('employment_status', employment_status);
    }

    if (is_active !== null && is_active !== undefined) {
      query = query.eq('is_active', is_active === 'true');
    }

    // Apply sorting
    if (sort_order === 'asc') {
      query = query.order(sort_by, { ascending: true });
    } else {
      query = query.order(sort_by, { ascending: false });
    }

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    // Execute query
    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching employees:', error);
      return NextResponse.json(
        { error: 'Gagal mengambil data karyawan' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: data as Employee[],
      total: count || 0,
      page,
      per_page: limit
    } as PaginatedResponse<Employee>);

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in employees API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}

// ============================================================
// POST /api/hris/employees
// Body: EmployeeCreateData
// ============================================================

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(EMPLOYEE_RECORD_MANAGERS);
    const db = createPgClient();
    const body: EmployeeCreateData = await request.json();

    // Validate required fields
    if (!body.full_name || !body.email || !body.join_date || !body.employment_status) {
      return NextResponse.json(
        { error: 'Field yang wajib diisi: nama lengkap, email, tanggal bergabung, status karyawan' },
        { status: 400 }
      );
    }

    // Check if NIP already exists (if provided manually)
    if (body.nip && body.nip.trim() !== '') {
      const { data: existing } = await db
        .from('employees')
        .select('id')
        .eq('nip', body.nip)
        .single();

      if (existing) {
        return NextResponse.json(
          { error: 'NIP sudah digunakan' },
          { status: 400 }
        );
      }
    }

    // Auto-generate NIP if not provided
    if (!body.nip || body.nip.trim() === '') {
      const year = new Date().getFullYear();
      let nip = '';
      let exists = true;
      let seq = 1;

      while (exists) {
        nip = `EMP-${year}-${String(seq).padStart(5, '0')}`;
        const { data: existing } = await db
          .from('employees')
          .select('id')
          .eq('nip', nip)
          .single();
        exists = !!existing;
        seq++;
        if (seq > 99999) {
          return NextResponse.json(
            { error: 'Tidak dapat generate NIP unik' },
            { status: 500 }
          );
        }
      }
      body.nip = nip;
    }

    // Check if email already exists
    const { data: existingEmail } = await db
      .from('employees')
      .select('id')
      .eq('email', body.email)
      .single();

    if (existingEmail) {
      return NextResponse.json(
        { error: 'Email sudah digunakan' },
        { status: 400 }
      );
    }

    // Insert employee with retry logic for NIP collision
    let insertResult;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      insertResult = await db
        .from('employees')
        .insert({
          nip: body.nip,
          full_name: body.full_name,
          email: body.email,
          phone: body.phone || '',
          join_date: body.join_date,
          employment_status: body.employment_status,
          department_id: body.department_id,
          section_id: body.section_id,
          job_title_id: body.job_title_id,
          reporting_to: body.reporting_to,
          ktp: body.ktp,
          npwp: body.npwp,
          birth_date: body.birth_date,
          gender: body.gender,
          marital_status: body.marital_status,
          address: body.address,
          city: body.city,
          province: body.province,
          postal_code: body.postal_code,
          bank_name: body.bank_name,
          bank_account: body.bank_account,
          bpjs_tk: body.bpjs_tk,
          bpjs_kesehatan: body.bpjs_kesehatan,
          emergency_contact_name: body.emergency_contact_name,
          emergency_contact_phone: body.emergency_contact_phone,
          emergency_contact_relationship: body.emergency_contact_relationship,
          photo_url: body.photo_url,
          notes: body.notes
        })
        .select(`
          *,
          department:departments (id, name, code),
          section:sections (id, name),
          job_title:positions (id, title),
          manager:employees!reporting_to (id, full_name, nip)
        `)
        .single();

      if (insertResult.error?.code === '23505' && insertResult.error?.message?.includes('nip')) {
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
        continue;
      }

      break;
    }

    const { data, error } = insertResult!;

    if (error) {
      console.error('Error creating employee:', error);

      if (error.code === '23505') {
        if (error.message?.includes('nip')) {
          return NextResponse.json(
            { error: 'NIP sudah digunakan, silakan coba lagi atau gunakan NIP lain' },
            { status: 400 }
          );
        }
        if (error.message?.includes('email')) {
          return NextResponse.json(
            { error: 'Email sudah terdaftar' },
            { status: 400 }
          );
        }
        if (error.message?.includes('ktp')) {
          return NextResponse.json(
            { error: 'NIK/KTP sudah terdaftar' },
            { status: 400 }
          );
        }
      }

      return NextResponse.json(
        { error: 'Gagal membuat data karyawan', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: data as Employee,
      message: 'Karyawan berhasil ditambahkan'
    } as ApiResponse<Employee>);

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in employees POST API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}
