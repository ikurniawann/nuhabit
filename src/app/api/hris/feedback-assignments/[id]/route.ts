import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { feedbackAssignmentUpdateSchema } from "@/lib/hris/feedback-schemas";

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
      .from('feedback_assignments')
      .select(`
        *,
        cycle:feedback_cycles(id, name, period_label, is_anonymous),
        employee:employees!employee_id(id, full_name, nip, department:departments(name), position:positions(title)),
        reviewer:employees!reviewer_id(id, full_name, nip, department:departments(name)),
        responses:feedback_responses(
          *,
          criteria:feedback_criteria(id, name, description, category:feedback_categories(id, name))
        )
      `)
      .eq('id', id)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error fetching feedback assignment:', error);
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
    const parsed = feedbackAssignmentUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Data tidak valid', details: parsed.error.issues }, { status: 400 });
    }
    const body = parsed.data;

    // Auto-set submitted_at when status changes to submitted
    if (body.status === 'submitted' && !body.submitted_at) {
      body.submitted_at = new Date().toISOString();
    }

    const { data, error } = await db
      .from('feedback_assignments')
      .update(body)
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error updating feedback assignment:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const { id } = await params;
    const db = createPgClient();

    const { error } = await db.from('feedback_assignments').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ message: 'Assignment deleted successfully' });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error deleting feedback assignment:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
