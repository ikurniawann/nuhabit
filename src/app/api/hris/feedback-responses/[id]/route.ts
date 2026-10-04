import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { feedbackResponseUpdateSchema } from "@/lib/hris/feedback-schemas";

// Modul 360 feedback belum punya UI; semua handler khusus pengelola kinerja.

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/hris/feedback-responses/[id]
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const { id } = await params;
    const db = createPgClient();

    const { data, error } = await db
      .from('feedback_responses')
      .select(`
        *,
        assignment:feedback_assignments(
          id,
          status,
          relationship_type,
          employee:employees(id, full_name, nip),
          reviewer:employees(id, full_name, nip),
          cycle:feedback_cycles(id, name, period_label)
        ),
        criteria:feedback_criteria(id, name, category_id)
      `)
      .eq('id', id)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 404 });

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error fetching feedback response:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/hris/feedback-responses/[id] - Update response
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const authClient = await createServerPgClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const db = createPgClient();
    const parsed = feedbackResponseUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Data tidak valid', details: parsed.error.issues }, { status: 400 });
    }

    const { data, error } = await db
      .from('feedback_responses')
      .update({
        ...parsed.data,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error updating feedback response:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/hris/feedback-responses/[id]
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const authClient = await createServerPgClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const db = createPgClient();

    const { error } = await db
      .from('feedback_responses')
      .delete()
      .eq('id', id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error deleting feedback response:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/hris/feedback-responses/[id]/approve - Approve submission
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const authClient = await createServerPgClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const db = createPgClient();
    const body = await request.json();
    const { manager_comments, cycle_id, employee_id } = body;

    // Get current user's employee record
    const { data: currentUser } = await db
      .from('employees')
      .select('id')
      .eq('email', user.email)
      .single();

    if (!currentUser) {
      return NextResponse.json({ error: 'User not found in employees table' }, { status: 404 });
    }

    // Update assignment status to approved
    const { data: assignment, error: updateError } = await db
      .from('feedback_assignments')
      .update({
        status: 'approved',
        manager_comments: manager_comments || null,
        approved_by: currentUser.id,
        approved_at: new Date().toISOString()
      })
      .eq('id', id)
      .select(`
        *,
        employee:employees(id, full_name, nip, email),
        cycle:feedback_cycles(name, period_label)
      `)
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Trigger summary recalculation (optional - can be done via trigger)
    // For now, we'll let the existing trigger handle it

    return NextResponse.json({ 
      success: true, 
      data: assignment,
      message: 'Feedback approved successfully' 
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error approving feedback:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/hris/feedback-responses/[id]/reject - Reject submission
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const authClient = await createServerPgClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const db = createPgClient();
    const body = await request.json();
    const { rejection_reason, cycle_id, employee_id } = body;

    if (!rejection_reason) {
      return NextResponse.json({ error: 'Rejection reason is required' }, { status: 400 });
    }

    // Get current user's employee record
    const { data: currentUser } = await db
      .from('employees')
      .select('id')
      .eq('email', user.email)
      .single();

    if (!currentUser) {
      return NextResponse.json({ error: 'User not found in employees table' }, { status: 404 });
    }

    // Update assignment status to rejected
    const { data: assignment, error: updateError } = await db
      .from('feedback_assignments')
      .update({
        status: 'rejected',
        rejection_reason: rejection_reason,
        approved_by: currentUser.id,
        approved_at: new Date().toISOString()
      })
      .eq('id', id)
      .select(`
        *,
        employee:employees(id, full_name, nip, email),
        cycle:feedback_cycles(name, period_label)
      `)
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Optionally notify employee about rejection
    // TODO: Implement notification service

    return NextResponse.json({ 
      success: true, 
      data: assignment,
      message: 'Feedback rejected. Employee has been notified.' 
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error rejecting feedback:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
