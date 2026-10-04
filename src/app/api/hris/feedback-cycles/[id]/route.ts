import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { feedbackCycleUpdateSchema } from "@/lib/hris/feedback-schemas";

// Modul 360 feedback belum punya UI; semua handler khusus pengelola kinerja.

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const { id } = await params;
    const db = createPgClient();

    const { data, error } = await db
      .from('feedback_cycles')
      .select(`
        *,
        created_by:employees!created_by(id, full_name),
        assignments:feedback_assignments(
          *,
          employee:employees!employee_id(id, full_name, nip),
          reviewer:employees!reviewer_id(id, full_name)
        ),
        summaries:feedback_summaries(
          *,
          employee:employees!employee_id(id, full_name, department:departments(name))
        )
      `)
      .eq('id', id)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error fetching feedback cycle:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const { id } = await params;
    const authClient = await createServerPgClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = createPgClient();
    const parsed = feedbackCycleUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Data tidak valid', details: parsed.error.issues }, { status: 400 });
    }

    const { data, error } = await db
      .from('feedback_cycles')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error updating feedback cycle:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const { id } = await params;
    const db = createPgClient();

    const { error } = await db.from('feedback_cycles').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ message: 'Cycle deleted successfully' });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error deleting feedback cycle:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
