import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { feedbackSummarySchema, type FeedbackSummaryInsert } from "@/lib/hris/feedback-schemas";

// Modul 360 feedback belum punya UI; semua handler khusus pengelola kinerja.

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const cycleId = searchParams.get('cycle_id');
    const employeeId = searchParams.get('employee_id');
    const minScore = searchParams.get('min_score');
    const maxScore = searchParams.get('max_score');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    let query = db
      .from('feedback_summaries')
      .select(`
        *,
        cycle:feedback_cycles(id, name, period_label, status),
        employee:employees!employee_id(
          id,
          full_name,
          nip,
          email,
          department:departments(id, name),
          position:positions(id, title)
        ),
        development_plans:development_plans(id, goal, status, progress)
      `, { count: 'exact' });

    if (cycleId) query = query.eq('cycle_id', cycleId);
    if (employeeId) query = query.eq('employee_id', employeeId);
    if (minScore) query = query.gte('final_score', parseFloat(minScore));
    if (maxScore) query = query.lte('final_score', parseFloat(maxScore));

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to).order('final_score', { ascending: false });

    const { data, error, count } = await query;
    
    if (error) {
      console.error('Database error:', error);
      return NextResponse.json({ error: error.message, details: error }, { status: 500 });
    }

    console.log('Feedback summaries fetched:', data?.length || 0);
    
    return NextResponse.json({
      data: data || [],
      pagination: { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error fetching feedback summaries:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const authClient = await createServerPgClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = createPgClient();
    const parsed = feedbackSummarySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Data tidak valid', details: parsed.error.issues }, { status: 400 });
    }
    const body: FeedbackSummaryInsert = parsed.data;

    // Calculate final score if KPI and 360 scores are provided
    if (body.kpi_score !== undefined && body.overall_360_score !== undefined) {
      const cycle = await db
        .from('feedback_cycles')
        .select('kpi_weight, feedback_weight')
        .eq('id', body.cycle_id)
        .single();

      const kpiWeight = cycle.data?.kpi_weight || 70;
      const feedbackWeight = cycle.data?.feedback_weight || 30;

      body.final_score = (body.kpi_score * (kpiWeight / 100)) + (body.overall_360_score * (feedbackWeight / 100));

      // Determine grade
      if (body.final_score >= 90) body.final_grade = 'A';
      else if (body.final_score >= 80) body.final_grade = 'B';
      else if (body.final_score >= 70) body.final_grade = 'C';
      else if (body.final_score >= 60) body.final_grade = 'D';
      else body.final_grade = 'E';
    }

    const { data, error } = await db
      .from('feedback_summaries')
      .insert(body)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error creating feedback summary:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
