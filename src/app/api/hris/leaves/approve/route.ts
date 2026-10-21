import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { withTransaction } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { buildWaLink } from "@/lib/recruitment/wa";
import { ApiError } from "@/lib/api/auth";
import {
  type AppliedCovers,
  applyCoversOnApproval,
  expireStaleRequests,
  finalizeAppliedCovers,
  getCoachLeaveContext,
  syncLeaveCovers,
  voidLeaveCovers,
} from "@/lib/studio/coach-cover-server";
import { assertCanDecideCoachLeave } from "@/lib/studio/coach-leave-server";
import { z } from 'zod';

// Validation schema for approval
const approvalSchema = z.object({
  leave_id: z.string().uuid(),
  action: z.enum(['approve', 'reject']),
  rejection_reason: z.string().optional(),
});

/**
 * POST /api/hris/leaves/approve
 * Approve / reject pengajuan cuti oleh HRD, manajer, atau admin.
 * approved_by ber-FK ke hris.employees(id) — diisi record karyawan approver
 * (null bila akun approver tidak tertaut karyawan, mis. super admin).
 * Update status + potong kuota berjalan dalam SATU transaksi.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate request
    const validated = approvalSchema.parse(body);

    const db = await createServerPgClient();
    const { data: leave, error: fetchError } = await db
      .from('leaves')
      .select(`
        *,
        employee:employees!employee_id(
          id,
          full_name,
          email,
          phone,
          reporting_to,
          department:departments(id, name),
          job_title:positions(id, title)
        )
      `)
      .eq('id', validated.leave_id)
      .single();

    if (fetchError || !leave) {
      return NextResponse.json(
        { error: 'Leave request not found' },
        { status: 404 }
      );
    }

    // SOP coach (EPIC-067): cuti coach diputus Program Director (atau approver
    // cadangan), bukan HRD/atasan. Karyawan lain tetap alur MSS di bawah.
    const coachLeave = await getCoachLeaveContext(validated.leave_id);
    if (coachLeave) {
      await assertCanDecideCoachLeave(
        coachLeave.branchId,
        { id: actor.userId, role: actor.role },
        coachLeave.requesterUserId
      );
    } else {
      // MSS: selain HR, ATASAN LANGSUNG karyawan (reporting_to) boleh approve
      const isDirectManager =
        actor.employeeId !== null && leave.employee?.reporting_to === actor.employeeId;
      if (!actor.isHr && !isDirectManager) {
        return NextResponse.json(
          { error: 'Forbidden: hanya HRD/admin atau atasan langsung yang bisa memproses' },
          { status: 403 }
        );
      }
    }

    // Check if already processed
    if (leave.status !== 'pending') {
      return NextResponse.json(
        { error: `Leave request already ${leave.status}`, current_status: leave.status },
        { status: 400 }
      );
    }

    // Validate rejection requires reason
    if (validated.action === 'reject' && !validated.rejection_reason) {
      return NextResponse.json(
        { error: 'Rejection reason is required' },
        { status: 400 }
      );
    }

    const isApprove = validated.action === 'approve';
    const newStatus = isApprove ? 'approved' : 'rejected';

    // Cuti coach: semua sesi terdampak harus sudah punya pengganti / diputuskan batal.
    if (coachLeave && isApprove) {
      await expireStaleRequests();
      await syncLeaveCovers(coachLeave);
    }

    // Status + potong kuota (+ pengganti coach) harus atomik — gagal salah satu, batal semua
    let applied: AppliedCovers | null = null;
    await withTransaction(async (client) => {
      if (coachLeave && isApprove) applied = await applyCoversOnApproval(client, validated.leave_id);
      await client.query(
        `UPDATE hris.leaves
         SET status = $2, approved_by = $3, approved_at = now(),
             rejection_reason = $4
         WHERE id = $1 AND status = 'pending'`,
        [
          validated.leave_id,
          newStatus,
          actor.employeeId,
          validated.action === 'reject' ? (validated.rejection_reason ?? null) : null,
        ]
      );

      if (isApprove && leave.leave_type === 'annual') {
        await client.query(
          `INSERT INTO hris.leave_balances (employee_id, year, annual_leave_total, annual_leave_used)
           VALUES ($1, $2, 12, $3)
           ON CONFLICT (employee_id, year)
           DO UPDATE SET annual_leave_used = leave_balances.annual_leave_used + $3,
                         updated_at = now()`,
          [leave.employee_id, new Date(leave.start_date).getFullYear(), leave.total_days]
        );
      }
    });

    // Kredit member sesi batal dikembalikan + WA ke member (T-067-A6).
    let releasedBookings = 0;
    if (coachLeave && applied) {
      releasedBookings = await finalizeAppliedCovers(coachLeave, actor.userId, applied as AppliedCovers);
    }
    if (coachLeave && !isApprove) await voidLeaveCovers(validated.leave_id, 'Cuti ditolak');

    const { data } = await db
      .from('leaves')
      .select(`
        *,
        employee:employees!employee_id(
          id,
          full_name,
          email,
          department:departments(name)
        ),
        approver:employees!approved_by(
          id,
          full_name,
          email
        )
      `)
      .eq('id', validated.leave_id)
      .single();

    // Notifikasi WhatsApp — pola wa.me link (konsisten dgn modul rekrutmen):
    // link dikembalikan ke UI utk dibuka approver
    const rangeLabel = `${leave.start_date} s.d. ${leave.end_date} (${leave.total_days} hari)`;
    const waMessage = isApprove
      ? `Halo ${leave.employee?.full_name}, pengajuan izin/cuti Anda ${rangeLabel} telah DISETUJUI. Selamat beristirahat!`
      : `Halo ${leave.employee?.full_name}, mohon maaf pengajuan izin/cuti Anda ${rangeLabel} DITOLAK. Alasan: ${validated.rejection_reason}. Silakan hubungi HRD untuk diskusi.`;
    const waLink = buildWaLink(leave.employee?.phone, waMessage);

    return NextResponse.json({
      message: `Leave request ${validated.action}d successfully`,
      action: validated.action,
      wa_link: waLink,
      data,
      ...(applied ? { covers: { ...(applied as AppliedCovers), released_bookings: releasedBookings } } : {}),
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in leave approval:', error);

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
