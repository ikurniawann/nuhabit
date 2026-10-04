import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne } from "@/lib/db";
import { readPrivateFile } from "@/lib/storage-private";
import {
  buildAttendancePdf,
  buildAttendanceXlsx,
  buildPeriodLabel,
  type AttendanceReportRow,
} from "@/lib/hris/attendance-report";
import { compressAttendancePhoto } from "@/lib/hris/attendance-photo-compress";

// Bulk attendance export is HR-only.
const HR_EXPORT_ROLES = ['super_admin', 'hrd'] as const;

/**
 * GET /api/hris/attendance/export
 * Export attendance data to CSV
 */
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisWorkforce);
    const db = await createServerPgClient();
    
    // Get query params
    const searchParams = request.nextUrl.searchParams;
    const employeeId = searchParams.get('employee_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const status = searchParams.get('status');
    const format = searchParams.get('format') || 'csv';

    // Build query
    let query = db
      .from('attendance')
      .select(`
        id,
        employee_id,
        date,
        clock_in,
        clock_out,
        clock_in_location,
        clock_out_location,
        work_hours,
        break_minutes,
        status,
        is_late,
        late_minutes,
        notes,
        clock_in_photo_url,
        clock_out_photo_url,
        created_at,
        employee:employees!attendance_employee_id_fkey(
          full_name,
          nip,
          department:departments(name),
          job_title:positions(title)
        )
      `);

    // Apply filters
    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }
    
    if (startDate && endDate) {
      query = query.gte('date', startDate).lte('date', endDate);
    }
    
    if (status) {
      query = query.eq('status', status);
    }

    query = query.order('date', { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching attendance for export:', error);
      return NextResponse.json(
        { error: 'Failed to fetch attendance data', details: error.message },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'No attendance data found' },
        { status: 404 }
      );
    }

    // Excel & PDF (permintaan owner 2026-08-28): HR kesulitan membaca CSV.
    if (format === 'xlsx' || format === 'pdf') {
      // Driver pg bisa mengembalikan kolom date sebagai objek Date — normalkan
      // ke YYYY-MM-DD memakai komponen lokal (toISOString bisa mundur sehari).
      const toDateStr = (v: unknown): string => {
        if (v instanceof Date) {
          const m = String(v.getMonth() + 1).padStart(2, '0');
          const d = String(v.getDate()).padStart(2, '0');
          return `${v.getFullYear()}-${m}-${d}`;
        }
        return String(v).slice(0, 10);
      };
      const rows: AttendanceReportRow[] = (data as Array<Record<string, unknown>>).map((r) => {
        const emp = r.employee as {
          full_name?: string; nip?: string | null;
          department?: { name?: string | null } | null;
          job_title?: { title?: string | null } | null;
        } | null;
        return {
          date: toDateStr(r.date),
          employeeName: emp?.full_name || '-',
          nip: emp?.nip ?? null,
          department: emp?.department?.name ?? null,
          position: emp?.job_title?.title ?? null,
          clockIn: (r.clock_in as string | null) ?? null,
          clockOut: (r.clock_out as string | null) ?? null,
          workHours: r.work_hours == null ? null : Number(r.work_hours),
          status: (r.status as string | null) ?? null,
          isLate: Boolean(r.is_late),
          lateMinutes: Number(r.late_minutes) || 0,
          notes: (r.notes as string | null) ?? null,
          clockInPhotoPath: (r.clock_in_photo_url as string | null) ?? null,
          clockOutPhotoPath: (r.clock_out_photo_url as string | null) ?? null,
        };
      });
      // Laporan urut naik per karyawan+tanggal — enak dibaca HR.
      rows.sort((a, b) =>
        a.employeeName === b.employeeName
          ? a.date.localeCompare(b.date)
          : a.employeeName.localeCompare(b.employeeName)
      );

      const outlet = await queryOne<{ name: string }>(
        'SELECT name FROM configuration.companies ORDER BY created_at LIMIT 1'
      );
      const meta = {
        companyName: outlet?.name ?? 'Arkiv OS',
        periodLabel:
          startDate && endDate ? buildPeriodLabel(startDate, endDate) : 'Semua tanggal',
        employeeLabel:
          employeeId && rows.length > 0 ? rows[0].employeeName : null,
        generatedAt: new Date(),
      };
      const stamp = new Date().toISOString().split('T')[0];

      if (format === 'xlsx') {
        const buffer = await buildAttendanceXlsx(rows, meta);
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="rekap-absensi-${stamp}.xlsx"`,
          },
        });
      }

      const buffer = await buildAttendancePdf(rows, meta, async (path) => {
        const { data: file, mime } = await readPrivateFile(path);
        if (!file) return null;
        // Kompres jadi thumbnail JPEG — rekap sebulan tetap ringan, dan
        // selfie webp/EXIF-rotated ikut beres (lihat attendance-photo-compress).
        return compressAttendancePhoto(file, mime ?? '');
      });
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="rekap-absensi-${stamp}.pdf"`,
        },
      });
    }

    // Convert to CSV
    const csv = convertToCSV(data);
    
    // Generate filename with date
    const filename = `attendance_export_${new Date().toISOString().split('T')[0]}.csv`;

    // Return CSV file
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv;charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in attendance export:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function convertToCSV(data: any[]): string {
  // Define CSV headers
  const headers = [
    'NIP',
    'Nama Karyawan',
    'Departemen',
    'Jabatan',
    'Tanggal',
    'Clock In',
    'Clock Out',
    'Lokasi Clock In',
    'Lokasi Clock Out',
    'Jam Kerja (jam)',
    'Istirahat (menit)',
    'Status',
    'Terlambat',
    'Keterlambatan (menit)',
    'Catatan',
  ];

  // Convert rows
  const rows = data.map((record) => {
    const clockIn = record.clock_in 
      ? new Date(record.clock_in).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
      : '-';
    
    const clockOut = record.clock_out 
      ? new Date(record.clock_out).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
      : '-';
    
    const clockInLocation = record.clock_in_location 
      ? `${record.clock_in_location.latitude},${record.clock_in_location.longitude}${record.clock_in_location.address ? ` (${record.clock_in_location.address})` : ''}`
      : '-';
    
    const clockOutLocation = record.clock_out_location 
      ? `${record.clock_out_location.latitude},${record.clock_out_location.longitude}${record.clock_out_location.address ? ` (${record.clock_out_location.address})` : ''}`
      : '-';

    return [
      record.employee?.nip || '-',
      record.employee?.full_name || '-',
      record.employee?.department?.name || '-',
      record.employee?.job_title?.title || '-',
      record.date,
      clockIn,
      clockOut,
      clockInLocation,
      clockOutLocation,
      record.work_hours || 0,
      record.break_minutes || 0,
      record.status || '-',
      record.is_late ? 'Ya' : 'Tidak',
      record.late_minutes || 0,
      record.notes || '-',
    ].map((field) => `"${String(field).replace(/"/g, '""')}"`).join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
