import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";

interface RouteParams {
  params: Promise<{ employee_id: string }>;
}

/**
 * GET /api/hris/leave-balances/:employee_id
 * Get leave balance for an employee
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const db = await createServerPgClient();
    const { employee_id } = await params;
    
    // Get query params
    const searchParams = request.nextUrl.searchParams;
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());

    // Check authentication
    const { data: { user } } = await db.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check permissions
    const isOwner = employee_id === await getCurrentEmployeeId(db, user.id);
    const isHRD = await checkIsHRD(db, user.id);
    const isManager = await checkIsManager(db, user.id);

    if (!isOwner && !isHRD && !isManager) {
      return NextResponse.json(
        { error: 'Forbidden: Can only view own leave balance' },
        { status: 403 }
      );
    }

    // Get leave balance
    const query = db
      .from('leave_balances')
      .select(`
        *,
        employee:employees(
          id,
          full_name,
          nip,
          photo_url,
          department:departments(name),
          job_title:positions(title)
        )
      `)
      .eq('employee_id', employee_id)
      .eq('year', year);

    // If not HRD, limit to own or department employees
    if (!isHRD) {
      // For manager, could add department filter here
    }

    const { data, error } = await query.single();

    if (error || !data) {
      // No balance record found, might need to initialize
      if (error?.code === 'PGRST116') {
        // Record doesn't exist, create default one
        const initialized = await initializeLeaveBalance(db, employee_id, year);
        return NextResponse.json({ data: initialized });
      }

      return NextResponse.json(
        { error: 'Failed to fetch leave balance', details: error?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error fetching leave balance:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/hris/leave-balances/:employee_id
 * Update leave balance (HRD only)
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

    // Check if HRD
    const isHRD = await checkIsHRD(db, user.id);
    if (!isHRD) {
      return NextResponse.json(
        { error: 'Forbidden: Only HRD can update leave balances' },
        { status: 403 }
      );
    }

    // Get query params
    const searchParams = request.nextUrl.searchParams;
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());

    // Build update object
    const updateData: any = {};
    
    if (body.annual_leave_total !== undefined) {
      updateData.annual_leave_total = body.annual_leave_total;
    }
    
    if (body.annual_leave_used !== undefined) {
      updateData.annual_leave_used = body.annual_leave_used;
    }
    
    if (body.sick_leave_used !== undefined) {
      updateData.sick_leave_used = body.sick_leave_used;
    }
    
    if (body.unpaid_leave_used !== undefined) {
      updateData.unpaid_leave_used = body.unpaid_leave_used;
    }

    // Get or create balance record
    const { data: balance } = await db
      .from('leave_balances')
      .select('id')
      .eq('employee_id', employee_id)
      .eq('year', year)
      .single();

    let result;
    
    if (balance) {
      // Update existing
      const { data, error } = await db
        .from('leave_balances')
        .update(updateData)
        .eq('id', balance.id)
        .select(`
          *,
          employee:employees(id, full_name, nip)
        `)
        .single();

      if (error) throw error;
      result = data;
    } else {
      // Create new with defaults + updates
      const { data, error } = await db
        .from('leave_balances')
        .insert({
          employee_id,
          year,
          annual_leave_total: 12,
          ...updateData,
        })
        .select(`
          *,
          employee:employees(id, full_name, nip)
        `)
        .single();

      if (error) throw error;
      result = data;
    }

    return NextResponse.json({
      message: 'Leave balance updated successfully',
      data: result,
    });
  } catch (error) {
    console.error('Error updating leave balance:', error);
    return NextResponse.json(
      { error: 'Failed to update leave balance', details: (error as any).message },
      { status: 500 }
    );
  }
}

// Helper function to initialize leave balance
async function initializeLeaveBalance(db: any, employeeId: string, year: number) {
  // Get employee join date to calculate pro-rated quota if needed
  const { data: employee } = await db
    .from('employees')
    .select('join_date, employment_status')
    .eq('id', employeeId)
    .single();

  if (!employee) {
    throw new Error('Employee not found');
  }

  // Calculate annual leave quota (default 12 days, can be pro-rated)
  let annualLeaveTotal = 12;
  
  // Pro-rate if joined mid-year (simplified logic)
  const joinYear = new Date(employee.join_date).getFullYear();
  if (joinYear === year) {
    const joinMonth = new Date(employee.join_date).getMonth();
    const monthsRemaining = 12 - joinMonth;
    annualLeaveTotal = Math.max(0, Math.floor((monthsRemaining / 12) * 12));
  }

  // Create balance record
  const { data, error } = await db
    .from('leave_balances')
    .insert({
      employee_id: employeeId,
      year,
      annual_leave_total: annualLeaveTotal,
      annual_leave_used: 0,
      sick_leave_used: 0,
      unpaid_leave_used: 0,
      maternity_leave_used: 0,
      paternity_leave_used: 0,
    })
    .select(`
      *,
      employee:employees(
        id,
        full_name,
        nip,
        department:departments(name),
        job_title:positions(title)
      )
    `)
    .single();

  if (error) throw error;
  return data;
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
