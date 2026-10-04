import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError } from "@/lib/api/auth";
import { EMPLOYEE_RECORD_MANAGERS, requireEmployeeAccess } from "@/lib/hris/employee-access";
import { IAM } from "@/lib/iam/prefixes";
import { z } from 'zod';

// Validation schema for resignation
const resignationSchema = z.object({
  resignation_type: z.enum(['voluntary', 'termination', 'layoff', 'end_of_contract']),
  resignation_date: z.string(),
  last_working_day: z.string(),
  reason: z.string().optional(),
});

interface RouteParams {
  params: Promise<{ employee_id: string }>;
}

/**
 * GET /api/hris/offboarding/:employee_id
 * Get offboarding checklist for an employee
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { employee_id } = await params;
    // Pengelola karyawan / rekrutmen, atau karyawan itu sendiri
    await requireEmployeeAccess(employee_id, [...EMPLOYEE_RECORD_MANAGERS, ...IAM.hrisRecruitment]);
    const db = await createServerPgClient();

    // Get offboarding checklist
    const { data, error } = await db
      .from('offboarding_checklists')
      .select(`
        *,
        employee:employees!employee_id(
          id,
          full_name,
          nip,
          photo_url,
          department:departments(name),
          job_title:positions(title)
        ),
        interviewer:employees!offboarding_checklists_exit_interview_conducted_by_fkey(
          id,
          full_name,
          nip
        ),
        completer:employees!offboarding_checklists_completed_by_fkey(
          id,
          full_name,
          nip
        )
      `)
      .eq('employee_id', employee_id);

    if (error) {
      console.error('Error fetching offboarding checklist:', error);
      return NextResponse.json(
        { error: 'Failed to fetch offboarding checklist', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: data || [],
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in offboarding GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/hris/offboarding/:employee_id
 * Initiate resignation/offboarding process
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const db = await createServerPgClient();
    const { employee_id } = await params;
    const body = await request.json();

    // Check authentication
    const { data: { user } } = await db.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Validate request
    const validated = resignationSchema.parse(body);

    // Check permissions (HRD, Manager, or self)
    const isHRD = await checkIsHRD(db, user.id);
    const isManager = await checkIsManager(db, user.id);
    const isOwner = employee_id === await getCurrentEmployeeId(db, user.id);

    // Self-resignation only allowed for voluntary
    if (isOwner && validated.resignation_type !== 'voluntary') {
      return NextResponse.json(
        { error: 'Only HRD/Manager can initiate non-voluntary resignation' },
        { status: 403 }
      );
    }

    if (!isHRD && !isManager && !isOwner) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // Verify employee exists and is active
    const { data: employee } = await db
      .from('employees')
      .select('id, full_name, employment_status, is_active')
      .eq('id', employee_id)
      .single();

    if (!employee || !employee.is_active) {
      return NextResponse.json(
        { error: 'Employee not found or inactive' },
        { status: 404 }
      );
    }

    // Check if already has offboarding
    const { data: existing } = await db
      .from('offboarding_checklists')
      .select('id')
      .eq('employee_id', employee_id)
      .eq('status', 'submitted')
      .single();

    if (existing) {
      return NextResponse.json(
        { error: 'Offboarding already initiated for this employee', offboarding_id: existing.id },
        { status: 400 }
      );
    }

    // Create offboarding checklist
    const { data, error } = await db
      .from('offboarding_checklists')
      .insert({
        employee_id,
        resignation_type: validated.resignation_type,
        resignation_date: validated.resignation_date,
        last_working_day: validated.last_working_day,
        reason: validated.reason || null,
        status: 'submitted',
        asset_return_status: {}, // Initialize empty
      })
      .select(`
        *,
        employee:employees!employee_id(
          id,
          full_name,
          nip,
          department:departments(name)
        )
      `)
      .single();

    if (error) {
      console.error('Error creating offboarding:', error);
      return NextResponse.json(
        { error: 'Failed to create offboarding checklist', details: error.message },
        { status: 500 }
      );
    }

    // TODO: Send notification to HRD, IT, Finance, Manager

    return NextResponse.json({
      message: 'Offboarding process initiated successfully',
      data,
    });
  } catch (error) {
    console.error('Error in offboarding POST:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/hris/offboarding/:employee_id
 * Update offboarding progress (clearance, asset return, etc.)
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const db = await createServerPgClient();
    const { employee_id } = await params;
    const body = await request.json();

    // Check authentication
    const { data: { user } } = await db.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if HRD or Manager
    const isHRD = await checkIsHRD(db, user.id);
    const isManager = await checkIsManager(db, user.id);

    if (!isHRD && !isManager) {
      return NextResponse.json(
        { error: 'Forbidden: Only HRD or managers can update offboarding' },
        { status: 403 }
      );
    }

    // Get offboarding record
    const { data: offboarding } = await db
      .from('offboarding_checklists')
      .select('*')
      .eq('employee_id', employee_id)
      .order('created_at', { ascending: false })
      .single();

    if (!offboarding) {
      return NextResponse.json(
        { error: 'Offboarding not found for this employee' },
        { status: 404 }
      );
    }

    // Build update object based on action
    const updateData: any = {};

    // Handle clearance updates
    if (body.clearance_type) {
      const clearanceField = `clearance_${body.clearance_type}`;
      const notesField = `clearance_${body.clearance_type}_notes`;
      
      if (body.cleared !== undefined) {
        updateData[clearanceField] = body.cleared;
      }
      
      if (body.notes !== undefined) {
        updateData[notesField] = body.notes;
      }
    }

    // Handle asset return updates
    if (body.asset_updates) {
      const currentAssets = offboarding.asset_return_status || {};
      updateData.asset_return_status = {
        ...currentAssets,
        ...body.asset_updates,
      };
    }

    // Handle status update
    if (body.status) {
      updateData.status = body.status;
      
      // If completing, set completed_at and completed_by
      if (body.status === 'completed') {
        updateData.completed_at = new Date().toISOString();
        updateData.completed_by = user.id;
      }
    }

    // Handle exit interview
    if (body.exit_interview_date !== undefined) {
      updateData.exit_interview_date = body.exit_interview_date;
    }
    
    if (body.exit_interview_conducted_by !== undefined) {
      updateData.exit_interview_conducted_by = body.exit_interview_conducted_by;
    }
    
    if (body.exit_interview_notes !== undefined) {
      updateData.exit_interview_notes = body.exit_interview_notes;
    }

    // Handle final payroll
    if (body.final_payroll_date !== undefined) {
      updateData.final_payroll_date = body.final_payroll_date;
    }
    
    if (body.final_payroll_amount !== undefined) {
      updateData.final_payroll_amount = body.final_payroll_amount;
    }
    
    if (body.final_payroll_notes !== undefined) {
      updateData.final_payroll_notes = body.final_payroll_notes;
    }

    // Update offboarding
    const { data, error } = await db
      .from('offboarding_checklists')
      .update(updateData)
      .eq('id', offboarding.id)
      .select(`
        *,
        employee:employees!employee_id(id, full_name, nip)
      `)
      .single();

    if (error) {
      console.error('Error updating offboarding:', error);
      return NextResponse.json(
        { error: 'Failed to update offboarding', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Offboarding updated successfully',
      data,
    });
  } catch (error) {
    console.error('Error in offboarding PUT:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Helper functions
async function getCurrentEmployeeId(db: any, userId: string) {
  const { data } = await db
    .from('employees')
    .select('id')
    .eq('user_id', userId)
    .single();
  
  return data?.id || null;
}

async function checkIsHRD(db: any, userId: string): Promise<boolean> {
  const { data } = await db
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();
  
  return data?.role === 'hrd' || false;
}

async function checkIsManager(db: any, userId: string): Promise<boolean> {
  const { data } = await db
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();
  
  return data?.role === 'hiring_manager' || data?.role === 'hrd' || false;
}
