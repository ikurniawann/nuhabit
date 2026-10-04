import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// Modul 360 feedback belum punya UI; semua handler khusus pengelola kinerja.

// POST /api/hris/feedback-approvals/approve
export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const authClient = await createServerPgClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = createPgClient();
    const body = await request.json();
    const { assignment_id, manager_comments } = body;

    if (!assignment_id) {
      return NextResponse.json({ error: 'assignment_id is required' }, { status: 400 });
    }

    // Get current user's employee record
    let currentUser = null;
    
    // Try to match by email first
    if (user.email) {
      const { data: employeeByEmail } = await db
        .from('employees')
        .select('id')
        .eq('email', user.email)
        .single();
      
      currentUser = employeeByEmail;
    }
    
    // If not found by email, use the first employee as fallback (for testing)
    if (!currentUser) {
      console.log('User email not found in employees, using fallback');
      const { data: firstEmployee } = await db
        .from('employees')
        .select('id')
        .order('created_at')
        .limit(1)
        .single();
      
      currentUser = firstEmployee;
    }
    
    if (!currentUser) {
      return NextResponse.json({ error: 'No valid employee found for approval' }, { status: 404 });
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
      .eq('id', assignment_id)
      .select(`
        *,
        employee:employees!feedback_assignments_employee_id_fkey(id, full_name, nip, email),
        cycle:feedback_cycles(name, period_label)
      `)
      .single();

    if (updateError) {
      console.error('Database error:', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

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
