import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { notifyLeaveRequestWa } from "@/lib/hris/leave-wa";
import { loadHolidayIndex } from "@/lib/hris/holidays-db";
import { describeLeaveDays } from "@/lib/hris/holidays";
import { evaluateCoachLeaveNotice } from "@/lib/studio/coach-leave-server";
import { onCoachLeaveSubmitted } from "@/lib/studio/coach-cover-server";
import { blackoutRejectionMessage, noticeRejectionMessage, shortNoticeMessage } from "@/lib/studio/coach-leave";
import { z } from 'zod';

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

// Validation schema for leave request
const leaveRequestSchema = z.object({
  employee_id: z.string().uuid().optional(),
  leave_type: z.enum(['annual', 'sick', 'maternity', 'paternity', 'unpaid', 'emergency', 'pilgrimage', 'menstrual', 'marriage', 'bereavement']),
  start_date: z.string().regex(DATE_ISO, 'Tanggal mulai harus berformat YYYY-MM-DD'),
  end_date: z.string().regex(DATE_ISO, 'Tanggal selesai harus berformat YYYY-MM-DD'),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
  attachment_url: z.string().optional(),
  // Coach meminta pengecualian tanggal blackout ke Program Director (EPIC-067 T-067-A2).
  blackout_exception: z.boolean().optional(),
});

/**
 * GET /api/hris/leaves
 * List leave requests with filters
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createPgClient();

    // Get query params
    const searchParams = request.nextUrl.searchParams;
    let employeeId = searchParams.get('employee_id');
    // non-HR hanya boleh melihat pengajuan cutinya sendiri
    if (!actor.isHr) {
      if (!actor.employeeId) {
        return NextResponse.json(
          { error: 'Akun ini tidak terhubung ke data karyawan' },
          { status: 403 }
        );
      }
      employeeId = actor.employeeId;
    }
    const status = searchParams.get('status');
    const leaveType = searchParams.get('leave_type');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    // Build query
    // Use FK column names as hints to disambiguate multiple relationships to employees
    let query = db
      .from('leaves')
      .select(`
        *,
        employee:employees!employee_id(
          id,
          full_name,
          nip,
          department:departments(name)
        ),
        approver:employees!approved_by(
          id,
          full_name,
          nip
        )
      `, { count: 'exact' });

    // Apply filters
    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }
    
    if (status) {
      query = query.eq('status', status);
    }
    
    if (leaveType) {
      query = query.eq('leave_type', leaveType);
    }
    
    if (startDate && endDate) {
      query = query.gte('start_date', startDate).lte('end_date', endDate);
    }

    // Pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to).order('created_at', { ascending: false });

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching leaves:', JSON.stringify(error));
      return NextResponse.json(
        { error: 'Failed to fetch leave requests', details: error.message, code: error.code, hint: (error as any).hint },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('Error in leaves GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/hris/leaves
 * Create new leave request
 */
export async function POST(request: NextRequest) {
  try {
    const db = createPgClient();
    const body = await request.json();

    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Validate request
    let validated;
    try {
      validated = leaveRequestSchema.parse(body);
    } catch (validationError) {
      console.error('Validation error:', validationError);
      if (validationError instanceof z.ZodError) {
        const errors = validationError.issues.map(e => `${e.path.join('.')}: ${e.message}`);
        return NextResponse.json(
          { error: 'Validation failed', details: errors },
          { status: 400 }
        );
      }
      throw validationError;
    }

    // non-HR hanya boleh mengajukan cuti untuk dirinya sendiri
    const empId =
      actor.isHr && validated.employee_id ? validated.employee_id : actor.employeeId;
    if (!empId) {
      return NextResponse.json(
        { error: 'Akun ini tidak terhubung ke data karyawan' },
        { status: 404 }
      );
    }

    // Check if employee exists and is active
    const { data: employee } = await db
      .from('employees')
      .select('id, full_name, employment_status, is_active')
      .eq('id', empId)
      .single();

    if (!employee || !employee.is_active) {
      return NextResponse.json(
        { error: 'Employee not found or inactive' },
        { status: 404 }
      );
    }

    if (validated.end_date < validated.start_date) {
      return NextResponse.json(
        { error: 'Tanggal selesai tidak boleh sebelum tanggal mulai' },
        { status: 400 }
      );
    }

    // SOP coach (EPIC-067 T-067-A1): minimal pemberitahuan H-N per jenis cuti.
    // Hanya untuk karyawan yang terhubung ke coach aktif. Di bawah H-N →
    // ditolak, kecuali jenis yang boleh mendadak (sakit, darurat, …) atau HR
    // yang mencatat → diterima dan ditandai is_short_notice.
    const notice = await evaluateCoachLeaveNotice(empId, validated.leave_type, validated.start_date, validated.end_date);
    if (notice && !notice.evaluation.ok && !actor.isHr) {
      return NextResponse.json(
        {
          error: noticeRejectionMessage(validated.leave_type, notice.rule, notice.evaluation.earliestStart),
          code: 'LEAVE_NOTICE_TOO_SHORT',
          min_days: notice.rule.min_days,
          earliest_start: notice.evaluation.earliestStart,
        },
        { status: 400 }
      );
    }
    const isShortNotice = notice ? !notice.evaluation.ok || notice.evaluation.shortNotice : false;

    // Tanggal blackout (T-067-A2): ditolak kecuali coach meminta pengecualian
    // (atau HR yang mencatat). Pengecualiannya sendiri diputus Program Director
    // dengan alasan saat menyetujui — lihat /api/hris/leaves/approve.
    const inBlackout = Boolean(notice && notice.blackouts.length > 0);
    if (notice && inBlackout && !validated.blackout_exception && !actor.isHr) {
      return NextResponse.json(
        {
          error: blackoutRejectionMessage(validated.leave_type, notice.blackouts),
          code: 'LEAVE_BLACKOUT',
          blackouts: notice.blackouts,
        },
        { status: 400 }
      );
    }

    // Hari yang benar-benar memotong jatah: akhir pekan dan libur nasional
    // dikecualikan, cuti bersama TETAP memotong (SKB). EPIC-036 Fase D —
    // sebelumnya hanya akhir pekan yang dikecualikan, sehingga cuti yang
    // melewati tanggal merah ikut memotong jatah karyawan.
    //
    // Sengaja TANPA backfill: cuti yang sudah disetujui memakai total_days
    // lamanya, karena saldo yang terpotong sudah terlanjur dicatat.
    const holidayIndex = await loadHolidayIndex(validated.start_date, validated.end_date);
    const { totalDays, excludedHolidays } = describeLeaveDays(
      validated.start_date,
      validated.end_date,
      holidayIndex
    );

    // 0 hari kerja = rentang yang seluruhnya akhir pekan/tanggal merah. Ditolak,
    // bukan diam-diam dihitung 1 hari seperti perilaku lama (`Math.max(1, …)`):
    // memotong jatah untuk hari yang memang sudah libur adalah bug yang sama.
    if (totalDays === 0) {
      const alasan = excludedHolidays.length > 0
        ? `sudah hari libur (${excludedHolidays.map((h) => h.name).join(', ')})`
        : 'jatuh pada akhir pekan';
      return NextResponse.json(
        { error: `Rentang tanggal ini ${alasan} — tidak perlu mengajukan cuti` },
        { status: 400 }
      );
    }

    // For annual leave, check quota
    if (validated.leave_type === 'annual') {
      const { data: balance } = await db
        .from('leave_balances')
        .select('annual_leave_remaining')
        .eq('employee_id', empId)
        .eq('year', new Date(validated.start_date).getFullYear())
        .single();

      if (balance && balance.annual_leave_remaining < totalDays) {
        return NextResponse.json(
          { 
            error: 'Insufficient annual leave balance',
            remaining: balance.annual_leave_remaining,
            requested: totalDays,
          },
          { status: 400 }
        );
      }
    }

    // Create leave request
    const { data, error } = await db
      .from('leaves')
      .insert({
        employee_id: empId,
        leave_type: validated.leave_type,
        start_date: validated.start_date,
        end_date: validated.end_date,
        total_days: totalDays,
        reason: validated.reason,
        attachment_url: validated.attachment_url || null,
        status: 'pending',
        is_short_notice: isShortNotice,
        notice_days: notice ? notice.evaluation.noticeDays : null,
        blackout_exception_requested: inBlackout,
      })
      .select('*')
      .single();

    if (error) {
      console.error('Error creating leave request:', JSON.stringify(error));
      return NextResponse.json(
        { error: 'Failed to create leave request', details: error.message, code: error.code, hint: (error as any).hint },
        { status: 500 }
      );
    }

    // Notifikasi WA ke atasan langsung (permintaan owner 2026-08-30) —
    // fire-and-forget: gagal kirim tidak menggagalkan pengajuannya.
    void notifyLeaveRequestWa({
      leaveId: String(data.id),
      employeeId: empId,
      employeeName: employee.full_name,
      leaveType: validated.leave_type,
      startDate: validated.start_date,
      endDate: validated.end_date,
      totalDays,
      reason: validated.reason ?? null,
      shortNotice: isShortNotice,
    });

    // Cuti coach: siapkan daftar sesi yang butuh pengganti + kabari approver (EPIC-067 T-067-A4).
    if (notice) void onCoachLeaveSubmitted(String(data.id));

    const notes = [
      notice && isShortNotice ? shortNoticeMessage(notice.rule, notice.evaluation.noticeDays) : null,
      inBlackout ? 'Jatuh di tanggal blackout — butuh pengecualian dari Program Director.' : null,
    ].filter(Boolean);
    return NextResponse.json({
      message: notes.length > 0 ? notes.join(' ') : 'Leave request submitted successfully',
      data,
      // Supaya pemanggil bisa menjelaskan kenapa total_days lebih kecil dari
      // rentang kalendernya (EPIC-036 Fase D).
      meta: { total_days: totalDays, excluded_holidays: excludedHolidays },
    });
  } catch (error) {
    console.error('Error in leaves POST:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.issues },
        { status: 400 }
      );
    }

    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Internal server error', details: msg },
      { status: 500 }
    );
  }
}

// calculateBusinessDays() dihapus di EPIC-036 Fase D — digantikan
// describeLeaveDays() dari src/lib/hris/holidays.ts yang juga mengecualikan
// hari libur resmi, bukan hanya akhir pekan.
