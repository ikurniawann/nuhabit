import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { feedbackCycleSchema } from "@/lib/hris/feedback-schemas";

// Modul 360 feedback belum punya UI; semua handler khusus pengelola kinerja.

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const periodLabel = searchParams.get('period_label');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    let query = db
      .from('feedback_cycles')
      .select(`
        *,
        created_by:employees!created_by(id, full_name),
        assignments_count:feedback_assignments(count),
        summaries_count:feedback_summaries(count)
      `, { count: 'exact' });

    if (status) query = query.eq('status', status);
    if (periodLabel) query = query.eq('period_label', periodLabel);

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
    console.error('Error fetching feedback cycles:', error);
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
    const parsed = feedbackCycleSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Data tidak valid', details: parsed.error.issues }, { status: 400 });
    }

    // Try to find employee matching the authenticated user's email or full_name
    let createdByEmployeeId = null;
    
    // First try to match by email (if users table has it)
    if (user.email) {
      const { data: employeeByEmail } = await db
        .from('employees')
        .select('id')
        .eq('email', user.email)
        .single();
      
      if (employeeByEmail) {
        createdByEmployeeId = employeeByEmail.id;
      }
    }
    
    // If not found by email, try to match by full_name from users table
    if (!createdByEmployeeId && user.user_metadata?.full_name) {
      const { data: employeeByName } = await db
        .from('employees')
        .select('id')
        .ilike('full_name', user.user_metadata.full_name)
        .single();
      
      if (employeeByName) {
        createdByEmployeeId = employeeByName.id;
      }
    }
    
    // Fallback: use first employee (e.g., EMP001/Admin) as default
    if (!createdByEmployeeId) {
      const { data: firstEmployee } = await db
        .from('employees')
        .select('id')
        .order('nip')
        .limit(1)
        .single();
      
      createdByEmployeeId = firstEmployee?.id || null;
    }

    if (!createdByEmployeeId) {
      return NextResponse.json({ 
        error: 'No valid employee found for created_by. Please ensure at least one employee exists.' 
      }, { status: 500 });
    }

    const { data, error } = await db
      .from('feedback_cycles')
      .insert({ ...parsed.data, created_by: createdByEmployeeId })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error creating feedback cycle:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
