// ============================================================
// API Route: Employee Documents
// GET: List documents for an employee
// POST: Add document record (after file upload to storage)
//
// Keamanan: GET boleh pengelola karyawan atau karyawan pemilik dokumen;
// POST khusus menu kepegawaian (sama dengan DELETE/PATCH di [doc_id]).
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
      .from('employee_documents')
      .select('*')
      .eq('employee_id', employee_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching documents:', error);
      return NextResponse.json({ error: 'Gagal mengambil dokumen' }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in documents API:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const db = await createServerPgClient();
    const body = await request.json();

    const { employee_id, document_type, document_name, file_url, file_size_kb, mime_type, issue_date, expiry_date, notes } = body;

    if (!employee_id || !document_type || !document_name || !file_url) {
      return NextResponse.json(
        { error: 'Field wajib: employee_id, document_type, document_name, file_url' },
        { status: 400 }
      );
    }

    const { data, error } = await db
      .from('employee_documents')
      .insert({
        employee_id,
        document_type,
        document_name,
        file_url,
        file_size_kb: file_size_kb || null,
        mime_type: mime_type || null,
        issue_date: issue_date || null,
        expiry_date: expiry_date || null,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating document:', error);
      return NextResponse.json({ error: 'Gagal menyimpan dokumen', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ data, message: 'Dokumen berhasil disimpan' }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in documents POST:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server' }, { status: 500 });
  }
}
