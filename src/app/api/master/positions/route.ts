import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

const READERS = [...IAM.hris, ...IAM.settingsUsers];

export async function GET() {
  const guard = await requireIamGuard(READERS);
  if (guard.error) return guard.error;
  const db = createPgClient();
  const { data, error } = await db
    .from('positions')
    .select('id, title, department, level, is_active, created_at, brand_id, brands(name)')
    .order('title');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data || [] });
}

export async function POST(request: NextRequest) {
  const guard = await requireIamGuard(IAM.hrisMaster);
  if (guard.error) return guard.error;
  const db = createPgClient();
  const body = await request.json();
  const { title, department = 'Operations', level = 'Staff', is_active = true, brand_id } = body;

  if (!title) {
    return NextResponse.json({ error: 'Nama jabatan wajib diisi' }, { status: 400 });
  }

  const { data, error } = await db
    .from('positions')
    .insert({
      title,
      department: department || 'Operations',
      level: level || 'Staff',
      is_active,
      brand_id: brand_id || null,
    })
    .select('id, title, department, level, is_active, created_at, brand_id, brands(name)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data, message: 'Jabatan berhasil ditambahkan' }, { status: 201 });
}
