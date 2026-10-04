import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { feedbackAssignmentSchema, oneOrMany } from "@/lib/hris/feedback-schemas";

// Modul 360 feedback belum punya UI; semua handler khusus pengelola kinerja.

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const cycleId = searchParams.get('cycle_id');
    const employeeId = searchParams.get('employee_id');
    const reviewerId = searchParams.get('reviewer_id');
    const status = searchParams.get('status');
    const relationshipType = searchParams.get('relationship_type');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    let query = db
      .from('feedback_assignments')
      .select(`
        *,
        cycle:feedback_cycles(id, name, period_label, status),
        employee:employees!employee_id(id, full_name, nip, department:departments(name), position:positions(title)),
        reviewer:employees!reviewer_id(id, full_name, nip)
      `, { count: 'exact' });

    if (cycleId) query = query.eq('cycle_id', cycleId);
    if (employeeId) query = query.eq('employee_id', employeeId);
    if (reviewerId) query = query.eq('reviewer_id', reviewerId);
    if (status) query = query.eq('status', status);
    if (relationshipType) query = query.eq('relationship_type', relationshipType);

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to).order('created_at', { ascending: false });

    const { data, error, count } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      data: data || [],
      pagination: { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error fetching feedback assignments:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const authClient = await createServerPgClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = createPgClient();
    // Support bulk insert for assigning multiple reviewers
    const parsed = oneOrMany(feedbackAssignmentSchema).safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Data tidak valid', details: parsed.error.issues }, { status: 400 });
    }
    const insertData = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

    const { data, error } = await db
      .from('feedback_assignments')
      .insert(insertData)
      .select(`
        *,
        cycle:feedback_cycles(id, name, period_label),
        employee:employees!employee_id(id, full_name, nip),
        reviewer:employees!reviewer_id(id, full_name)
      `);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error creating feedback assignment:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
