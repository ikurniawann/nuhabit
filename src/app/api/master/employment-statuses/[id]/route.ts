import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

interface RouteParams { params: Promise<{ id: string }> }

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const guard = await requireIamGuard(IAM.hrisMaster);
  if (guard.error) return guard.error;
  const db = createPgClient();
  const { id } = await params;
  const body = await request.json();
  const { code, name, color, description, is_active } = body;

  if (!code || !name) {
    return NextResponse.json({ error: 'Kode dan nama wajib diisi' }, { status: 400 });
  }

  const { data, error } = await db
    .from('employment_statuses')
    .update({ code: code.toLowerCase(), name, color: color || 'gray', description: description || null, is_active, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, code, name, color, description, is_active, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Kode status sudah digunakan' }, { status: 400 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data, message: 'Status kepegawaian berhasil diupdate' });
}

export async function DELETE(_: NextRequest, { params }: RouteParams) {
  const guard = await requireIamGuard(IAM.hrisMaster);
  if (guard.error) return guard.error;
  const db = createPgClient();
  const { id } = await params;

  const { data: status } = await db
    .from('employment_statuses')
    .select('code')
    .eq('id', id)
    .single();

  if (status) {
    const { count } = await db
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('employment_status', status.code);

    if (count && count > 0) {
      return NextResponse.json({ error: `Tidak dapat dihapus, masih ada ${count} karyawan dengan status ini` }, { status: 400 });
    }
  }

  const { error } = await db.from('employment_statuses').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: 'Status kepegawaian berhasil dihapus' });
}
