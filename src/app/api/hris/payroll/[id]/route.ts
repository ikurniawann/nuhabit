// ============================================================
// API Route: Payroll Run by ID
// GET: Get payroll run detail with details
// PUT: Update payroll run (process/approve/pay) — transisi status divalidasi
// DELETE: Delete payroll run (hanya Super Admin; run paid tidak bisa dihapus)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { withTransaction } from "@/lib/db";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { canDeletePayrollRun, PAYROLL_MANAGE_ROLES } from '@/lib/payroll/roles';
import {
  allocateLoanPayment,
  isLoanDue,
  type LoanDeductionRow,
} from '@/lib/payroll/loans';
import {
  canDeleteRun,
  canTransitionRunStatus,
} from '@/lib/payroll/run-status';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ============================================================
// GET /api/hris/payroll/[id]
// ============================================================

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisCompensation);
    const db = await createServerPgClient();
    const { id } = await params;

    const { data, error } = await db
      .from('payroll_runs')
      .select(`
        *,
        processed_by:employees!processed_by (
          id,
          full_name,
          nip
        ),
        approved_by:employees!approved_by (
          id,
          full_name,
          nip
        ),
        payroll_details:payroll_details (
          id,
          employee_id,
          net_salary,
          gross_salary,
          total_deductions,
          pph21_deduction,
          status,
          payslip_sent,
          payslip_sent_at,
          employee:employees!employee_id (
            id,
            full_name,
            nip,
            department_id,
            department:departments (
              name
            )
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Payroll run tidak ditemukan' },
          { status: 404 }
        );
      }
      console.error('Error fetching payroll run:', error);
      return NextResponse.json(
        { error: 'Gagal mengambil data payroll' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in payroll API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}

// ============================================================
// PUT /api/hris/payroll/[id]
// Update payroll run status (process, approve, pay)
// ============================================================

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const apiUser = await requireIamMenuPrefix(IAM.hrisCompensation);
    const db = await createServerPgClient();
    const { id } = await params;
    const body = await request.json();
    const { status, notes } = body;

    const { data: existing } = await db
      .from('payroll_runs')
      .select('id, status, period_month, period_year')
      .eq('id', id)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json(
        { error: 'Payroll run tidak ditemukan' },
        { status: 404 }
      );
    }

    // Get employee record for current user
    const { data: currentUser } = await db
      .from('employees')
      .select('id')
      .eq('auth_id', apiUser.id)
      .maybeSingle();

    // Build update data
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (notes !== undefined) {
      updateData.notes = notes;
    }

    // Set status timestamps based on status change
    if (status && status !== existing.status) {
      if (!canTransitionRunStatus(existing.status, status)) {
        return NextResponse.json(
          {
            error: `Transisi status '${existing.status}' → '${status}' tidak diizinkan`,
          },
          { status: 400 }
        );
      }

      updateData.status = status;

      if (status === 'processing') {
        updateData.processed_by = currentUser?.id;
        updateData.processed_at = new Date().toISOString();
      } else if (status === 'completed') {
        updateData.approved_by = currentUser?.id;
        updateData.approved_at = new Date().toISOString();
      } else if (status === 'paid') {
        // EPIC-008 Fase D: transisi paid = SATU transaksi — set status
        // (guard status 'completed' di SQL, anti balapan dobel-paid) +
        // kurangi saldo pinjaman sesuai cicilan yang terpotong di slip.
        let paidResult;
        try {
          paidResult = await markRunPaidAndSettleLoans(
            id,
            existing.period_month,
            existing.period_year,
            typeof notes === 'string' ? notes : null
          );
        } catch (settleError) {
          if (settleError instanceof LoanAllocationMismatchError) {
            return NextResponse.json(
              {
                error:
                  'Cicilan pinjaman di slip tidak lagi cocok dengan saldo pinjaman saat ini ' +
                  '(kemungkinan run periode lain ditandai dibayar lebih dulu). ' +
                  'Hapus run ini lalu buat & hitung ulang sebelum menandai dibayar.',
                shortfalls: settleError.shortfalls,
              },
              { status: 409 }
            );
          }
          throw settleError;
        }
        if (!paidResult.ok) {
          return NextResponse.json(
            { error: 'Run sudah diproses/berubah status — muat ulang halaman' },
            { status: 409 }
          );
        }
        const { data: paidRun } = await db
          .from('payroll_runs')
          .select(`
            *,
            processed_by:employees!processed_by ( id, full_name, nip ),
            approved_by:employees!approved_by ( id, full_name, nip )
          `)
          .eq('id', id)
          .single();
        return NextResponse.json({
          data: paidRun,
          message: `Payroll ditandai dibayar${paidResult.settledLoans > 0 ? ` — ${paidResult.settledLoans} cicilan pinjaman dipotong dari saldo` : ''}`,
        });
      }
    }

    const { data, error } = await db
      .from('payroll_runs')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        processed_by:employees!processed_by (
          id,
          full_name,
          nip
        ),
        approved_by:employees!approved_by (
          id,
          full_name,
          nip
        )
      `)
      .single();

    if (error) {
      console.error('Error updating payroll run:', error);
      return NextResponse.json(
        { error: 'Gagal update payroll run', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data,
      message: 'Payroll run berhasil diupdate'
    });

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in payroll API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}

/**
 * Slip berisi potongan cicilan yang tidak lagi cocok dengan saldo pinjaman
 * saat ini (mis. run periode lain dibayar duluan) — transaksi HARUS batal
 * agar potongan di slip tidak "hilang" tanpa teralokasi ke pinjaman mana pun.
 */
class LoanAllocationMismatchError extends Error {
  constructor(public shortfalls: { employee_id: string; amount: number }[]) {
    super('Alokasi cicilan pinjaman tidak cocok dengan slip');
    this.name = 'LoanAllocationMismatchError';
  }
}

/**
 * Tandai run paid + kurangi saldo pinjaman — atomik dalam satu transaksi.
 * Guard `status = 'completed'` di SQL membuat operasi idempoten: pemanggilan
 * kedua tidak mengubah run dan TIDAK memotong saldo dua kali.
 */
async function markRunPaidAndSettleLoans(
  runId: string,
  periodMonth: number,
  periodYear: number,
  notes: string | null
): Promise<{ ok: boolean; settledLoans: number }> {
  let settledLoans = 0;
  let ok = false;

  await withTransaction(async (client) => {
    const runUpdate = await client.query(
      `UPDATE hris.payroll_runs
       SET status = 'paid', paid_at = now(), updated_at = now(),
           notes = COALESCE($2, notes)
       WHERE id = $1 AND status = 'completed'
       RETURNING id`,
      [runId, notes]
    );
    if (runUpdate.rowCount === 0) {
      return; // status sudah berubah — jangan sentuh pinjaman
    }
    ok = true;

    const { rows: details } = await client.query(
      `SELECT employee_id, loan_deduction
       FROM hris.payroll_details
       WHERE payroll_run_id = $1 AND loan_deduction > 0`,
      [runId]
    );

    const shortfalls: { employee_id: string; amount: number }[] = [];

    for (const detail of details) {
      // FOR UPDATE: kunci baris pinjaman agar alokasi tidak balapan
      const { rows: loans } = await client.query(
        `SELECT id, monthly_installment, remaining_balance,
                first_installment_month, first_installment_year,
                status, is_active
         FROM hris.loans
         WHERE employee_id = $1 AND status = 'approved' AND is_active = true
           AND remaining_balance > 0
         ORDER BY approved_at ASC NULLS LAST, created_at ASC
         FOR UPDATE`,
        [detail.employee_id]
      );

      const dueLoans = (loans as LoanDeductionRow[]).filter((loan) =>
        isLoanDue(loan, periodMonth, periodYear)
      );
      const deducted = Math.round(Number(detail.loan_deduction));
      const allocations = allocateLoanPayment(dueLoans, deducted);

      // Slip memotong X tapi hanya Y yang bisa dialokasikan (saldo pinjaman
      // sudah berubah sejak run dihitung — mis. run lain dibayar duluan).
      // Jangan commit diam-diam: kumpulkan selisih lalu batalkan transaksi.
      const allocated = allocations.reduce((acc, a) => acc + a.amount, 0);
      if (allocated < deducted) {
        shortfalls.push({
          employee_id: detail.employee_id,
          amount: deducted - allocated,
        });
        continue;
      }

      for (const alloc of allocations) {
        await client.query(
          // $2 di-cast eksplisit: dipakai sekaligus sebagai nilai kolom
          // numeric DAN dibandingkan dengan literal 0, sehingga tanpa cast
          // Postgres menolak dengan "inconsistent types deduced for
          // parameter $2".
          `UPDATE hris.loans
           SET remaining_balance = $2::numeric,
               paid_amount = COALESCE(paid_amount, 0) + $3::numeric,
               is_active = CASE WHEN $2::numeric <= 0 THEN false ELSE is_active END,
               status = CASE WHEN $2::numeric <= 0 THEN 'paid_off' ELSE status END,
               updated_at = now()
           WHERE id = $1`,
          [alloc.loanId, alloc.newRemaining, alloc.amount]
        );
        settledLoans += 1;
      }
    }

    if (shortfalls.length > 0) {
      throw new LoanAllocationMismatchError(shortfalls); // rollback semua
    }
  });

  return { ok, settledLoans };
}

// ============================================================
// DELETE /api/hris/payroll/[id]
// Delete payroll run
// ============================================================

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisCompensation);
    if (!canDeletePayrollRun(user.role)) {
      return NextResponse.json(
        { error: 'Hanya Super Admin yang dapat menghapus data payroll' },
        { status: 403 }
      );
    }
    const db = await createServerPgClient();
    const { id } = await params;

    // Check if payroll run exists
    const { data: existing } = await db
      .from('payroll_runs')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json(
        { error: 'Payroll run tidak ditemukan' },
        { status: 404 }
      );
    }

    if (!canDeleteRun(existing.status)) {
      return NextResponse.json(
        { error: 'Payroll yang sudah dibayar tidak bisa dihapus' },
        { status: 400 }
      );
    }

    // FK payroll_details_run_fk ON DELETE CASCADE (migrasi Fase F) —
    // detail ikut terhapus otomatis, tanpa delete manual dua langkah.
    const { error } = await db
      .from('payroll_runs')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting payroll run:', error);
      return NextResponse.json(
        { error: 'Gagal menghapus payroll run', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Payroll run berhasil dihapus'
    });

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in payroll DELETE API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}
