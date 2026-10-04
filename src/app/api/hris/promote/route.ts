// ============================================================
// API Route: Promote Candidate to Employee
// POST: Promote kandidat dari Talent Pool menjadi Employee
// Menggunakan function: promote_candidate_to_employee()
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { Employee, PromotionRequest, ApiResponse } from '@/types/hris';
import { queryOne } from '@/lib/db';
import { draftContractFromEmploymentStatus } from '@/lib/hris/contracts';
import { createDraftContract } from '@/lib/hris/create-contract';

/**
 * Fase D modul kontrak: setelah kandidat dipromosikan jadi karyawan, buatkan
 * draft kontrak otomatis. Tipe dipetakan dari employment_status pilihan HRD
 * (contract → PKWT 12 bln; probation → PKWTT + percobaan 3 bln; permanent →
 * PKWTT), gaji & posisi diambil dari offer terakhir yang diterima. Gagal
 * membuat draft TIDAK menggagalkan promote — hanya dicatat di response.
 */
async function autoDraftContract(
  employeeId: string,
  candidateId: string,
  joinDate: string,
  employmentStatus: string
): Promise<{ contractNumber: string | null; warning: string | null }> {
  const dates = draftContractFromEmploymentStatus(employmentStatus, joinDate);
  if (!dates) return { contractNumber: null, warning: null };

  try {
    const offer = await queryOne<{
      version: number;
      position_title: string | null;
      base_salary: string | null;
    }>(
      `SELECT version, position_title, base_salary
       FROM recruitment.candidate_offers
       WHERE candidate_id = $1 AND status = 'accepted'
       ORDER BY version DESC LIMIT 1`,
      [candidateId]
    );

    const result = await createDraftContract({
      employeeId,
      contractType: dates.contract_type,
      startDate: dates.start_date,
      endDate: dates.end_date,
      probationEndDate: dates.probation_end_date,
      positionTitle: offer?.position_title ?? null,
      baseSalary: offer?.base_salary ?? null,
      notes:
        `Draft otomatis saat promote kandidat` +
        (offer ? ` (dari offer v${offer.version} yang diterima)` : "") +
        `${dates.contract_type === "pkwt" ? " — durasi default 12 bulan, sesuaikan sebelum aktivasi" : ""}.`,
      createdByName: "Sistem (promote kandidat)",
    });

    if (!result.ok) return { contractNumber: null, warning: result.error };
    return { contractNumber: result.contract.contract_number, warning: null };
  } catch (error) {
    console.error('[promote] auto-draft contract failed:', error);
    return {
      contractNumber: null,
      warning: 'Karyawan dibuat, tetapi draft kontrak otomatis gagal — buat manual di tab Kontrak',
    };
  }
}

// ============================================================
// POST /api/hris/promote
// Body: { candidate_id, join_date?, employment_status?, department_id?, reporting_to? }
// ============================================================

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisRecruitment);
    const db = await createServerPgClient();
    const body: PromotionRequest = await request.json();

    // Validate required fields
    if (!body.candidate_id) {
      return NextResponse.json(
        { error: 'candidate_id wajib diisi' },
        { status: 400 }
      );
    }

    // Get candidate data first to verify status
    const { data: candidate, error: candidateError } = await db
      .from('candidates')
      .select(`
        *,
        position:positions (id, title, department),
        brand:brands (id, name)
      `)
      .eq('id', body.candidate_id)
      .single();

    if (candidateError || !candidate) {
      return NextResponse.json(
        { error: 'Kandidat tidak ditemukan' },
        { status: 404 }
      );
    }

    // Check if candidate already promoted
    if (candidate.promoted_to_employee_id) {
      return NextResponse.json(
        { error: 'Kandidat sudah dipromosikan menjadi employee' },
        { status: 400 }
      );
    }

    // Check candidate status
    if (!['hired', 'talent_pool'].includes(candidate.status)) {
      return NextResponse.json(
        { 
          error: `Status kandidat harus "hired" atau "talent_pool" untuk dipromosikan. Status saat ini: ${candidate.status}`,
          suggestion: 'Ubah status kandidat menjadi "hired" terlebih dahulu'
        },
        { status: 400 }
      );
    }

    // Try to use database function first
    let employeeId: string | null = null;
    
    try {
      const { data, error: rpcError } = await db.rpc('promote_candidate_to_employee', {
        p_candidate_id: body.candidate_id,
        p_join_date: body.join_date || new Date().toISOString().split('T')[0],
        p_employment_status: body.employment_status || 'probation',
        p_department_id: body.department_id || null,
        p_reporting_to: body.reporting_to || null
      });

      if (!rpcError && data) {
        employeeId = data as string;
      }
    } catch (rpcFallbackError) {
      console.log('RPC function not available, using manual fallback');
    }

    // Fallback: Manual promote if function failed or not available
    if (!employeeId) {
      console.log('Using manual promote fallback...');
      
      // Generate NIP
      const year = new Date().getFullYear();
      let nip = '';
      let exists = true;
      let seq = 1;
      
      while (exists && seq < 99999) {
        nip = `EMP-${year}-${String(seq).padStart(5, '0')}`;
        const { data: existing } = await db
          .from('employees')
          .select('id')
          .eq('nip', nip)
          .single();
        exists = !!existing;
        seq++;
      }
      
      // Insert employee manually
      const { data: newEmployee, error: insertError } = await db
        .from('employees')
        .insert({
          nip,
          full_name: candidate.full_name,
          email: candidate.email,
          phone: candidate.phone || '',
          join_date: body.join_date || new Date().toISOString().split('T')[0],
          employment_status: body.employment_status || 'probation',
          department_id: body.department_id || null,
          job_title_id: candidate.position?.id || null,
          reporting_to: body.reporting_to || null,
          is_active: true,
        })
        .select()
        .single();
      
      if (insertError) {
        console.error('Manual insert error:', insertError);
        return NextResponse.json(
          { error: 'Gagal membuat karyawan', details: insertError.message },
          { status: 500 }
        );
      }
      
      employeeId = newEmployee?.id || null;
      
      // Update candidate
      if (employeeId) {
        await db
          .from('candidates')
          .update({ promoted_to_employee_id: employeeId })
          .eq('id', candidate.id);
      }
    }
    const { data: employee, error: employeeError } = await db
      .from('employees')
      .select(`
        *,
        department:departments (id, name, code),
        job_title:positions (id, title)
      `)
      .eq('id', employeeId)
      .single();

    if (employeeError) {
      console.error('Error fetching created employee:', employeeError);
    }

    // Fase D: draft kontrak otomatis dari offer yang diterima
    const joinDate = body.join_date || new Date().toISOString().split('T')[0];
    const employmentStatus = body.employment_status || 'probation';
    const contractDraft = employeeId
      ? await autoDraftContract(employeeId, candidate.id, joinDate, employmentStatus)
      : { contractNumber: null, warning: null };

    const contractInfo = contractDraft.contractNumber
      ? ` — draft kontrak ${contractDraft.contractNumber} dibuat otomatis`
      : contractDraft.warning
        ? ` — ${contractDraft.warning}`
        : '';

    return NextResponse.json({
      data: employee as Employee,
      employee_id: employeeId,
      nip: employee?.nip,
      contract_number: contractDraft.contractNumber,
      message: `Berhasil mempromosikan ${candidate.full_name} menjadi karyawan${contractInfo}`,
      candidate: {
        id: candidate.id,
        full_name: candidate.full_name,
        promoted_to_employee_id: employeeId
      }
    } as ApiResponse<Employee> & { employee_id: string; nip?: string; contract_number?: string | null; candidate?: any });

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in promote API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}
