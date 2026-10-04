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
    .from('departments')
    .select('id, name, code, description, is_active, created_at, updated_at')
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data || [] });
}

export async function POST(request: NextRequest) {
  const guard = await requireIamGuard(IAM.hrisMaster);
  if (guard.error) return guard.error;
  const db = createPgClient();
  const body = await request.json();
  const { name, code, description, is_active = true } = body;

  if (!name || !code) {
    return NextResponse.json({ error: 'Nama dan kode wajib diisi' }, { status: 400 });
  }

  const { data, error } = await db
    .from('departments')
    .insert({ name, code: code.toUpperCase(), description: description || null, is_active })
    .select('id, name, code, description, is_active, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Kode departemen sudah digunakan' }, { status: 400 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data, message: 'Departemen berhasil ditambahkan' }, { status: 201 });
}
