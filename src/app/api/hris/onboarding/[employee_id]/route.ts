import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError } from "@/lib/api/auth";
import { EMPLOYEE_RECORD_MANAGERS, requireEmployeeAccess } from "@/lib/hris/employee-access";
import { IAM } from "@/lib/iam/prefixes";

interface RouteParams {
  params: Promise<{ employee_id: string }>;
}

/**
 * GET /api/hris/onboarding/:employee_id
 * Get onboarding checklist for an employee
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { employee_id } = await params;
    // Pengelola karyawan / rekrutmen, atau karyawan itu sendiri
    await requireEmployeeAccess(employee_id, [...EMPLOYEE_RECORD_MANAGERS, ...IAM.hrisRecruitment]);
    const db = await createServerPgClient();
    
    // Get query params
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category');
    const completed = searchParams.get('completed'); // 'true', 'false', or 'all'

    // Build query
    let query = db
      .from('onboarding_checklists')
      .select(`
        *,
        employee:employees!employee_id(
          id,
          full_name,
          nip,
          photo_url,
          department:departments(name),
          job_title:positions(title),
          join_date
        ),
        completer:employees!onboarding_checklists_completed_by_fkey(
          id,
          full_name,
          nip
        ),
        assignee:employees!onboarding_checklists_assigned_to_fkey(
          id,
          full_name,
          nip
        )
      `)
      .eq('employee_id', employee_id);

    // Filter by category
    if (category) {
      query = query.eq('category', category);
    }

    // Filter by completion status
    if (completed === 'true') {
      query = query.eq('completed', true);
    } else if (completed === 'false') {
      query = query.eq('completed', false);
    }

    // Order by priority and due date
    query = query.order('priority', { ascending: true }).order('due_date', { ascending: true });

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching onboarding checklist:', error);
      return NextResponse.json(
        { error: 'Failed to fetch onboarding checklist', details: error.message },
        { status: 500 }
      );
    }

    // Calculate summary
    const total = data?.length || 0;
    const completedCount = data?.filter(t => t.completed).length || 0;
    const pendingCount = total - completedCount;
    const progressPercentage = total > 0 ? Math.round((completedCount / total) * 100) : 0;

    return NextResponse.json({
      data: data || [],
      summary: {
        total,
        completed: completedCount,
        pending: pendingCount,
        progress: progressPercentage,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in onboarding GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/hris/onboarding/:employee_id
 * Complete a task or add new task
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

    // Check permissions
    const isHRD = await checkIsHRD(db, user.id);
    const isManager = await checkIsManager(db, user.id);
    const isOwner = employee_id === await getCurrentEmployeeId(db, user.id);

    if (!isHRD && !isManager && !isOwner) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // If action is to complete a task
    if (body.action === 'complete' && body.task_id) {
      // Only HRD, Manager, or Assignee can mark as complete
      if (!isHRD && !isManager) {
        // Check if user is the assignee
        const { data: task } = await db
          .from('onboarding_checklists')
          .select('assigned_to')
          .eq('id', body.task_id)
          .single();

        if (task?.assigned_to !== user.id) {
          return NextResponse.json(
            { error: 'Forbidden: Not authorized to complete this task' },
            { status: 403 }
          );
        }
      }

      // Mark task as complete
      const { data, error } = await db
        .from('onboarding_checklists')
        .update({
          completed: true,
          completed_at: new Date().toISOString(),
          completed_by: user.id,
          completion_notes: body.completion_notes || null,
        })
        .eq('id', body.task_id)
        .select()
        .single();

      if (error) {
        console.error('Error completing task:', error);
        return NextResponse.json(
          { error: 'Failed to complete task', details: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        message: 'Task completed successfully',
        data,
      });
    }

    // If action is to add a new task (HRD/Manager only)
    if (body.action === 'add' && (isHRD || isManager)) {
      const { data, error } = await db
        .from('onboarding_checklists')
        .insert({
          employee_id,
          task_name: body.task_name,
          category: body.category,
          description: body.description,
          priority: body.priority || 3,
          due_date: body.due_date,
          assigned_to: body.assigned_to || user.id,
        })
        .select()
        .single();

      if (error) {
        console.error('Error adding task:', error);
        return NextResponse.json(
          { error: 'Failed to add task', details: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        message: 'Task added successfully',
        data,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "complete" with task_id or "add" with task details' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error in onboarding POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/hris/onboarding/:employee_id
 * Update task (HRD/Manager only)
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
        { error: 'Forbidden: Only HRD or managers can update tasks' },
        { status: 403 }
      );
    }

    // Update specific task
    if (body.task_id) {
      const updateData: any = {};
      
      if (body.task_name !== undefined) updateData.task_name = body.task_name;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.priority !== undefined) updateData.priority = body.priority;
      if (body.due_date !== undefined) updateData.due_date = body.due_date;
      if (body.assigned_to !== undefined) updateData.assigned_to = body.assigned_to;
      if (body.category !== undefined) updateData.category = body.category;

      const { data, error } = await db
        .from('onboarding_checklists')
        .update(updateData)
        .eq('id', body.task_id)
        .eq('employee_id', employee_id) // Ensure task belongs to this employee
        .select()
        .single();

      if (error) {
        console.error('Error updating task:', error);
        return NextResponse.json(
          { error: 'Failed to update task', details: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        message: 'Task updated successfully',
        data,
      });
    }

    return NextResponse.json(
      { error: 'task_id is required' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error in onboarding PUT:', error);
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
