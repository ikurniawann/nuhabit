import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// Bulk leave export is HR-only.
const HR_EXPORT_ROLES = ['super_admin', 'hrd'] as const;

/**
 * GET /api/hris/leaves/export
 * Export leave requests data to CSV
 */
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisWorkforce);
    const db = await createServerPgClient();
    
    // Get query params
    const searchParams = request.nextUrl.searchParams;
    const employeeId = searchParams.get('employee_id');
    const status = searchParams.get('status');
    const leaveType = searchParams.get('leave_type');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const format = searchParams.get('format') || 'csv';

    // Build query
    let query = db
      .from('leaves')
      .select(`
        *,
        employee:employees!employee_id(
          full_name,
          nip,
          department:departments(name),
          job_title:positions(title)
        ),
        approver:employees!leaves_approved_by_fkey(
          full_name,
          nip
        )
      `);

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

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching leaves for export:', error);
      return NextResponse.json(
        { error: 'Failed to fetch leave data', details: error.message },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'No leave data found' },
        { status: 404 }
      );
    }

    // Convert to CSV
    const csv = convertToCSV(data);
    
    // Generate filename with date
    const filename = `leave_export_${new Date().toISOString().split('T')[0]}.csv`;

    // Return CSV file
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv;charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in leaves export:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function convertToCSV(data: any[]): string {
  // Define CSV headers
  const headers = [
    'ID Cuti',
    'NIP',
    'Nama Karyawan',
    'Departemen',
    'Jabatan',
    'Jenis Cuti',
    'Tanggal Mulai',
    'Tanggal Selesai',
    'Total Hari',
    'Alasan',
    'Status',
    'Disetujui Oleh',
    'Tanggal Disetujui',
    'Alasan Penolakan',
    'Tanggal Pengajuan',
  ];

  // Convert rows
  const rows = data.map((record) => {
    const leaveTypeLabel = getLeaveTypeLabel(record.leave_type);
    const statusLabel = getStatusLabel(record.status);
    
    const approvedBy = record.approver 
      ? `${record.approver.full_name} (${record.approver.nip})`
      : '-';
    
    const approvedAt = record.approved_at 
      ? new Date(record.approved_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
      : '-';

    return [
      record.id,
      record.employee?.nip || '-',
      record.employee?.full_name || '-',
      record.employee?.department?.name || '-',
      record.employee?.job_title?.title || '-',
      leaveTypeLabel,
      record.start_date,
      record.end_date,
      record.total_days || 0,
      record.reason || '-',
      statusLabel,
      approvedBy,
      approvedAt,
      record.rejection_reason || '-',
      new Date(record.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
    ].map((field) => `"${String(field).replace(/"/g, '""')}"`).join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

function getLeaveTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    annual: 'Cuti Tahunan',
    sick: 'Cuti Sakit',
    maternity: 'Cuti Melahirkan',
    paternity: 'Cuti Ayah',
    unpaid: 'Cuti Tanpa Upah',
    emergency: 'Cuti Darurat',
    pilgrimage: 'Cuti Haji/Umrah',
    menstrual: 'Cuti Haid',
  };
  
  return labels[type] || type;
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Menunggu Persetujuan',
    approved: 'Disetujui',
    rejected: 'Ditolak',
    cancelled: 'Dibatalkan',
  };
  
  return labels[status] || status;
}
