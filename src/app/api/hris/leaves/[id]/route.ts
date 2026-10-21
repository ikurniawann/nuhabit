import { NextRequest, NextResponse } from 'next/server';
import { removeLeaveTimeOff, voidLeaveCovers } from "@/lib/studio/coach-cover-server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { withTransaction } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/hris/leaves/:id
 * Get leave request detail by ID
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const db = await createServerPgClient();
    const { id } = await params;

    const { data, error } = await db
      .from('leaves')
      .select(`
        *,
        employee:employees!employee_id(
          id,
          full_name,
          nip,
          photo_url,
          email,
          phone,
          department:departments(name),
          job_title:positions(title)
        ),
        approver:employees!leaves_approved_by_fkey(
          id,
          full_name,
          nip,
          email
        )
      `)
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Leave request not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error fetching leave detail:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/hris/leaves/:id
 * - Karyawan: batalkan pengajuannya sendiri yang masih pending.
 * - HR: batalkan cuti (termasuk yang SUDAH disetujui — kuota tahunan
 *   dikembalikan dalam transaksi yang sama) dan edit alasan/lampiran.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const db = await createServerPgClient();
    const { id } = await params;
    const body = await request.json();

    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get current leave request
    const { data: leave } = await db
      .from('leaves')
      .select('*')
      .eq('id', id)
      .single();

    if (!leave) {
      return NextResponse.json(
        { error: 'Leave request not found' },
        { status: 404 }
      );
    }

    const isOwner = actor.employeeId !== null && leave.employee_id === actor.employeeId;

    // ── Pembatalan ──────────────────────────────────────────────────────
    if (body.status === 'cancelled') {
      const cancellablePending = leave.status === 'pending' && (isOwner || actor.isHr);
      const cancellableApproved = leave.status === 'approved' && actor.isHr;
      if (!cancellablePending && !cancellableApproved) {
        return NextResponse.json(
          {
            error:
              leave.status === 'approved'
                ? 'Cuti yang sudah disetujui hanya bisa dibatalkan oleh HRD/admin'
                : 'Pengajuan ini tidak bisa dibatalkan',
          },
          { status: 403 }
        );
      }

      // batalkan + kembalikan kuota (bila sebelumnya approved & memotong kuota)
      const refund = cancellableApproved && leave.leave_type === 'annual';
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE hris.leaves SET status = 'cancelled' WHERE id = $1`,
          [id]
        );
        if (refund) {
          await client.query(
            `UPDATE hris.leave_balances
             SET annual_leave_used = GREATEST(annual_leave_used - $3, 0),
                 updated_at = now()
             WHERE employee_id = $1 AND year = $2`,
            [leave.employee_id, new Date(leave.start_date).getFullYear(), leave.total_days]
          );
        }
      });
      // Cuti coach (EPIC-067): permintaan pengganti yang belum diterapkan gugur,
      // time-off hasil sinkron cuti dihapus (T-067-A5).
      // Pengganti yang sudah diterapkan (cuti sempat disetujui) tidak dikembalikan
      // otomatis — jadwal diatur ulang Program Director di Kalender bila perlu.
      await voidLeaveCovers(id, 'Cuti dibatalkan');
      await removeLeaveTimeOff(id);

      return NextResponse.json({
        message: refund
          ? `Cuti dibatalkan — kuota ${leave.total_days} hari dikembalikan`
          : 'Pengajuan dibatalkan',
      });
    }

    // ── Edit metadata oleh HR ────────────────────────────────────────────
    if (!actor.isHr) {
      return NextResponse.json(
        { error: 'No valid updates or insufficient permissions' },
        { status: 403 }
      );
    }
    const updateData: any = {};
    if (body.reason !== undefined) updateData.reason = body.reason;
    if (body.attachment_url !== undefined) updateData.attachment_url = body.attachment_url;
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No valid updates or insufficient permissions' },
        { status: 403 }
      );
    }

    const { data, error } = await db
      .from('leaves')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating leave:', error);
      return NextResponse.json(
        { error: 'Failed to update leave request', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Leave request updated successfully',
      data,
    });
  } catch (error) {
    console.error('Error in leave PUT:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/hris/leaves/:id
 * Delete leave request (HRD only)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const db = await createServerPgClient();
    const { id } = await params;

    // Check authentication
    const { data: { user } } = await db.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user is HRD
    const isHRD = await checkIsHRD(db, user.id);
    if (!isHRD) {
      return NextResponse.json(
        { error: 'Forbidden: Only HRD can delete leave requests' },
        { status: 403 }
      );
    }

    // Delete leave
    const { error } = await db
      .from('leaves')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting leave:', error);
      return NextResponse.json(
        { error: 'Failed to delete leave request', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Leave request deleted successfully',
    });
  } catch (error) {
    console.error('Error in leave DELETE:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Helper functions
async function checkIsHRD(db: any, userId: string): Promise<boolean> {
  const { data } = await db
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();

  return data?.role === 'hrd' || data?.role === 'super_admin' || data?.role === 'admin' || false;
}
