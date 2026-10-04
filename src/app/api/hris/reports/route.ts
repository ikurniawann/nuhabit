// ============================================================
// API Route: HRIS Reports
// GET: Aggregated stats for dashboard reporting
// Query params: month (1-12), year (YYYY)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

export async function GET(request: NextRequest) {
  const guard = await requireIamGuard(IAM.hrisInsights);
  if (guard.error) return guard.error;
  try {
    const db = await createServerPgClient();
    const searchParams = request.nextUrl.searchParams;
    const now = new Date();
    const month = parseInt(searchParams.get('month') || String(now.getMonth() + 1));
    const year = parseInt(searchParams.get('year') || String(now.getFullYear()));

    // Date range for the selected month
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

    // ── 1. HEADCOUNT ──────────────────────────────────────────
    const { data: allEmployees } = await db
      .from('employees')
      .select('id, employment_status, is_active, department_id, join_date, end_date')
      .order('full_name');

    const activeEmployees = allEmployees?.filter(e => e.is_active) || [];
    const totalActive = activeEmployees.length;

    // By employment status
    const byStatus: Record<string, number> = {};
    activeEmployees.forEach(e => {
      byStatus[e.employment_status] = (byStatus[e.employment_status] || 0) + 1;
    });

    // New hires this month
    const newHires = allEmployees?.filter(e =>
      e.join_date >= startDate && e.join_date < endDate
    ).length || 0;

    // Resigned/terminated this year
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year + 1}-01-01`;
    const turnoverCount = allEmployees?.filter(e =>
      (e.employment_status === 'resigned' || e.employment_status === 'terminated') &&
      e.end_date && e.end_date >= yearStart && e.end_date < yearEnd
    ).length || 0;

    const turnoverRate = totalActive > 0 ? ((turnoverCount / (totalActive + turnoverCount)) * 100).toFixed(1) : '0.0';

    // ── 2. HEADCOUNT BY DEPARTMENT ───────────────────────────
    const { data: departments } = await db
      .from('departments')
      .select('id, name')
      .eq('is_active', true)
      .order('name');

    const headcountByDept = (departments || []).map(d => ({
      name: d.name,
      count: activeEmployees.filter(e => e.department_id === d.id).length,
    })).filter(d => d.count > 0);

    // ── 3. ATTENDANCE STATS (selected month) ─────────────────
    const { data: attendanceData } = await db
      .from('attendance')
      .select('status, is_late, work_hours, employee_id, date')
      .gte('date', startDate)
      .lt('date', endDate);

    const totalAttendanceRecords = attendanceData?.length || 0;
    const presentCount = attendanceData?.filter(a => a.status === 'present').length || 0;
    const absentCount = attendanceData?.filter(a => a.status === 'absent').length || 0;
    const lateCount = attendanceData?.filter(a => a.is_late).length || 0;
    const avgWorkHours = totalAttendanceRecords > 0
      ? (attendanceData!.reduce((s, a) => s + (a.work_hours || 0), 0) / totalAttendanceRecords).toFixed(1)
      : '0.0';
    const presentRate = totalAttendanceRecords > 0
      ? ((presentCount / totalAttendanceRecords) * 100).toFixed(1)
      : '0.0';
    const lateRate = presentCount > 0
      ? ((lateCount / presentCount) * 100).toFixed(1)
      : '0.0';

    // Daily attendance trend (present count per day)
    const dailyMap: Record<string, { present: number; absent: number; late: number }> = {};
    attendanceData?.forEach(a => {
      if (!dailyMap[a.date]) dailyMap[a.date] = { present: 0, absent: 0, late: 0 };
      if (a.status === 'present') dailyMap[a.date].present++;
      if (a.status === 'absent') dailyMap[a.date].absent++;
      if (a.is_late) dailyMap[a.date].late++;
    });
    const dailyTrend = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({
        date: new Date(date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
        ...counts,
      }));

    // ── 4. LEAVE STATS (selected month) ──────────────────────
    const { data: leavesData } = await db
      .from('leaves')
      .select('leave_type, status, total_days, employee_id')
      .gte('start_date', startDate)
      .lt('start_date', endDate);

    const approvedLeaves = leavesData?.filter(l => l.status === 'approved') || [];
    const pendingLeaves = leavesData?.filter(l => l.status === 'pending').length || 0;
    const totalLeaveDays = approvedLeaves.reduce((s, l) => s + (l.total_days || 0), 0);

    // Leave by type
    const leaveByType: Record<string, number> = {};
    approvedLeaves.forEach(l => {
      leaveByType[l.leave_type] = (leaveByType[l.leave_type] || 0) + (l.total_days || 0);
    });
    const leaveTypeData = Object.entries(leaveByType).map(([type, days]) => ({
      type: LEAVE_TYPE_LABELS[type] || type,
      days,
    })).sort((a, b) => b.days - a.days);

    // ── 5. 6-MONTH HEADCOUNT TREND ────────────────────────────
    const monthlyHeadcount = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(year, month - 1 - i, 1);
      const mStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const nextD = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const mEnd = `${nextD.getFullYear()}-${String(nextD.getMonth() + 1).padStart(2, '0')}-01`;
      const count = allEmployees?.filter(e =>
        e.join_date < mEnd && (!e.end_date || e.end_date >= mStart)
      ).length || 0;
      monthlyHeadcount.push({
        month: d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }),
        count,
      });
    }

    return NextResponse.json({
      period: { month, year },
      headcount: {
        total_active: totalActive,
        new_hires: newHires,
        turnover_count: turnoverCount,
        turnover_rate: parseFloat(turnoverRate),
        by_status: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
        by_department: headcountByDept,
        monthly_trend: monthlyHeadcount,
      },
      attendance: {
        total_records: totalAttendanceRecords,
        present_count: presentCount,
        absent_count: absentCount,
        late_count: lateCount,
        present_rate: parseFloat(presentRate),
        late_rate: parseFloat(lateRate),
        avg_work_hours: parseFloat(avgWorkHours),
        daily_trend: dailyTrend,
      },
      leaves: {
        approved_count: approvedLeaves.length,
        pending_count: pendingLeaves,
        total_days: totalLeaveDays,
        by_type: leaveTypeData,
      },
    });
  } catch (error) {
    console.error('Error in reports API:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server' }, { status: 500 });
  }
}

const LEAVE_TYPE_LABELS: Record<string, string> = {
  annual: 'Tahunan',
  sick: 'Sakit',
  maternity: 'Melahirkan',
  paternity: 'Ayah',
  unpaid: 'Tidak Dibayar',
  emergency: 'Darurat',
  pilgrimage: 'Haji/Umrah',
  menstrual: 'Haid',
  marriage: 'Pernikahan',
  bereavement: 'Duka Cita',
};
