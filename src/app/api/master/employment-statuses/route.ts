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
    .from('employment_statuses')
    .select('id, code, name, color, description, is_active, created_at, updated_at')
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data || [] });
}

export async function POST(request: NextRequest) {
  const guard = await requireIamGuard(IAM.hrisMaster);
  if (guard.error) return guard.error;
  const db = createPgClient();
  const body = await request.json();
  const { code, name, color = 'gray', description, is_active = true } = body;

  if (!code || !name) {
    return NextResponse.json({ error: 'Kode dan nama wajib diisi' }, { status: 400 });
  }

  const { data, error } = await db
    .from('employment_statuses')
    .insert({ code: code.toLowerCase(), name, color, description: description || null, is_active })
    .select('id, code, name, color, description, is_active, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Kode status sudah digunakan' }, { status: 400 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data, message: 'Status kepegawaian berhasil ditambahkan' }, { status: 201 });
}
