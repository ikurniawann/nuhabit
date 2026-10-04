import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { feedbackResponseSchema, oneOrMany } from "@/lib/hris/feedback-schemas";

// Modul 360 feedback belum punya UI; semua handler khusus pengelola kinerja.

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const assignmentId = searchParams.get('assignment_id');
    const criteriaId = searchParams.get('criteria_id');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');

    let query = db
      .from('feedback_responses')
      .select(`
        *,
        assignment:feedback_assignments(
          id,
          employee:employees!employee_id(id, full_name),
          reviewer:employees!reviewer_id(id, full_name),
          relationship_type
        ),
        criteria:feedback_criteria(
          id,
          name,
          description,
          category:feedback_categories(id, name, weight)
        )
      `, { count: 'exact' });

    if (assignmentId) query = query.eq('assignment_id', assignmentId);
    if (criteriaId) query = query.eq('criteria_id', criteriaId);

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
    console.error('Error fetching feedback responses:', error);
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
    // Support bulk insert for submitting multiple responses at once
    const parsed = oneOrMany(feedbackResponseSchema).safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Data tidak valid', details: parsed.error.issues }, { status: 400 });
    }
    const body = parsed.data;
    const insertData = Array.isArray(body) ? body : [body];

    const { data, error } = await db
      .from('feedback_responses')
      .insert(insertData)
      .select(`
        *,
        criteria:feedback_criteria(id, name, category:feedback_categories(name))
      `);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Update assignment status to submitted if all responses are complete
    if (!Array.isArray(body) && body.assignment_id) {
      // Check if all criteria have been answered
      const { data: allCriteria } = await db
        .from('feedback_criteria')
        .select('id', { count: 'exact' });

      const { data: existingResponses } = await db
        .from('feedback_responses')
        .select('criteria_id')
        .eq('assignment_id', body.assignment_id);

      if (allCriteria && existingResponses && existingResponses.length >= allCriteria.length) {
        await db
          .from('feedback_assignments')
          .update({ status: 'submitted', submitted_at: new Date().toISOString() })
          .eq('id', body.assignment_id);
      }
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error creating feedback response:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
