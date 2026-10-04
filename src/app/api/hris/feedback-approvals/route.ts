import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// Modul 360 feedback belum punya UI; semua handler khusus pengelola kinerja.

// GET /api/hris/feedback-approvals - Get pending approvals for manager
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const authClient = await createServerPgClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status') || 'submitted';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    console.log('Fetching approvals with status:', status);

    // Query assignments that need manager approval
    let query = db
      .from('feedback_assignments')
      .select(`
        *,
        employee:employees!feedback_assignments_employee_id_fkey(
          id,
          nip,
          full_name,
          email,
          department:departments(name),
          position:positions(title)
        ),
        reviewer:employees!feedback_assignments_reviewer_id_fkey(
          id,
          nip,
          full_name
        ),
        cycle:feedback_cycles(
          id,
          name,
          period_label,
          status
        ),
        responses:feedback_responses(
          id,
          rating,
          comments,
          criteria:feedback_criteria(
            name,
            category:feedback_categories(name)
          )
        )
      `, { count: 'exact' })
      .eq('relationship_type', 'self'); // Only self-assessments need approval

    // Filter by specific status
    if (status === 'pending' || status === 'submitted') {
      query = query.eq('status', 'submitted');
    } else if (status === 'approved' || status === 'rejected') {
      query = query.eq('status', status);
    } else if (status === 'all') {
      query = query.in('status', ['submitted', 'approved', 'rejected']);
    }

    // Pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to).order('submitted_at', { ascending: false });

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching approvals:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('Fetched approvals:', data?.length || 0);

    // Calculate summary stats
    const stats = {
      total: count || 0,
      pending: data?.filter((a: any) => a.status === 'submitted').length || 0,
      approved: data?.filter((a: any) => a.status === 'approved').length || 0,
      rejected: data?.filter((a: any) => a.status === 'rejected').length || 0,
    };

    return NextResponse.json({ 
      data: data || [], 
      stats,
      pagination: { 
        page, 
        limit, 
        total: count || 0, 
        totalPages: Math.ceil((count || 0) / limit) 
      } 
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error fetching feedback approvals:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/hris/feedback-approvals - Bulk approve/reject
export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const authClient = await createServerPgClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = createPgClient();
    const body = await request.json();
    const { assignment_ids, action, comments, rejection_reason } = body;

    if (!assignment_ids || !Array.isArray(assignment_ids)) {
      return NextResponse.json({ error: 'assignment_ids is required' }, { status: 400 });
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Action must be "approve" or "reject"' }, { status: 400 });
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

    // Update assignments
    const updateData = {
      status: action === 'approve' ? 'approved' : 'rejected',
      approved_by: currentUser.id,
      approved_at: new Date().toISOString(),
      ...(action === 'approve' ? { manager_comments: comments } : { rejection_reason }),
    };

    const { data, error } = await db
      .from('feedback_assignments')
      .update(updateData)
      .in('id', assignment_ids)
      .select(`
        *,
        employee:employees!feedback_assignments_employee_id_fkey(full_name, nip)
      `);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ 
      success: true, 
      data,
      message: `Successfully ${action}d ${data?.length || 0} submission(s)` 
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error bulk processing approvals:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
