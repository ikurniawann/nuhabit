import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne, withTransaction } from "@/lib/db";
import {
  computeKompensasi,
  monthsWorked,
  pkwtChainTotalMonths,
  validateContractDates,
  validatePkwtTotal,
} from "@/lib/hris/contracts";
import { withContractNumber } from "@/lib/hris/contract-number";

/**
 * PATCH  /api/hris/contracts/[id] — aksi siklus hidup kontrak:
 *   activate  draft → active   (sinkron employment_status + employment_history)
 *   end       active → ended   (PKWT: hitung uang kompensasi PP 35/2021)
 *   terminate draft|active → terminated (PKWT aktif: kompensasi pro-rata)
 *   convert   active PKWT → converted (lanjut buat kontrak PKWTT baru)
 *   renew     active PKWT → draft perpanjangan dalam rantai yang sama
 *   edit      ubah isi draft (tanggal, gaji, lokasi — validasi compliance ulang)
 *   update    edit metadata (ttd, dokumen, pencatatan Kemnaker, pembayaran)
 * DELETE /api/hris/contracts/[id] — hapus draft saja.
 */

const ROLES = ["super_admin", "admin", "hrd"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface ContractRow {
  id: string;
  employee_id: string;
  contract_number: string;
  contract_type: "pkwt" | "pkwtt";
  status: string;
  start_date: string;
  end_date: string | null;
  probation_end_date: string | null;
  base_salary: string | null;
  position_title: string | null;
  department_name: string | null;
  work_location: string | null;
  notes: string | null;
  signed_at: string | null;
  kemnaker_registered_at: string | null;
  compensation_paid_at: string | null;
  sequence: number;
}

async function loadContract(id: string): Promise<ContractRow | null> {
  return queryOne<ContractRow>(
    `SELECT id, employee_id, contract_number, contract_type, status,
            start_date, end_date, probation_end_date, base_salary,
            position_title, department_name, work_location, notes,
            signed_at, kemnaker_registered_at, compensation_paid_at, sequence
     FROM hris.employment_contracts WHERE id = $1`,
    [id]
  );
}

interface PatchBody {
  action?: string;
  end_date?: string | null;
  reason?: string;
  signed_at?: string | null;
  signed_document_url?: string;
  kemnaker_registered_at?: string | null;
  compensation_paid_at?: string | null;
  notes?: string | null;
  // aksi edit (draft saja)
  start_date?: string;
  probation_end_date?: string | null;
  position_title?: string | null;
  work_location?: string | null;
  base_salary?: number | string | null;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID kontrak tidak valid" }, { status: 400 });
    }
    const contract = await loadContract(id);
    if (!contract) {
      return NextResponse.json({ error: "Kontrak tidak ditemukan" }, { status: 404 });
    }

    const body = (await req.json()) as PatchBody;

    switch (body.action) {
      case "activate":
        return activate(contract, body, user.id);
      case "end":
        return end(contract, body);
      case "terminate":
        return terminate(contract, body);
      case "convert":
        return convert(contract);
      case "renew":
        return renew(contract, body, user.full_name);
      case "edit":
        return editDraft(contract, body);
      case "update":
        return updateMeta(contract, body);
      default:
        return NextResponse.json({ error: "Aksi tidak dikenal" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[contracts] PATCH failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function activate(contract: ContractRow, body: PatchBody, userId: string) {
  if (contract.status !== "draft") {
    return NextResponse.json(
      { error: "Hanya kontrak berstatus draft yang bisa diaktifkan" },
      { status: 409 }
    );
  }
  const activeOther = await queryOne<{ contract_number: string }>(
    `SELECT contract_number FROM hris.employment_contracts
     WHERE employee_id = $1 AND status = 'active' AND id <> $2`,
    [contract.employee_id, contract.id]
  );
  if (activeOther) {
    return NextResponse.json(
      {
        error: `Karyawan masih punya kontrak aktif (${activeOther.contract_number}) — akhiri dulu sebelum mengaktifkan kontrak baru`,
      },
      { status: 409 }
    );
  }

  const employee = await queryOne<{ employment_status: string }>(
    `SELECT employment_status FROM hris.employees WHERE id = $1`,
    [contract.employee_id]
  );
  // recorded_by ber-FK ke hris.employees(id) — petakan dari akun auth;
  // NULL bila akun yang mengaktifkan tidak terhubung ke record karyawan
  const recorder = await queryOne<{ id: string }>(
    `SELECT id FROM hris.employees WHERE user_id = $1`,
    [userId]
  );

  const today = new Date().toISOString().slice(0, 10);
  const inProbation =
    contract.probation_end_date !== null && contract.probation_end_date >= today;
  const newStatus =
    contract.contract_type === "pkwt" ? "contract" : inProbation ? "probation" : "permanent";

  // satu transaksi — kegagalan salah satu langkah tidak boleh meninggalkan
  // kontrak aktif tanpa sinkron status karyawan/riwayat
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE hris.employment_contracts
       SET status = 'active', signed_at = COALESCE($2::date, signed_at, now()::date)
       WHERE id = $1`,
      [contract.id, body.signed_at ?? null]
    );
    await client.query(
      `UPDATE hris.employees SET employment_status = $2, end_date = $3
       WHERE id = $1`,
      [
        contract.employee_id,
        newStatus,
        contract.contract_type === "pkwt" ? contract.end_date : null,
      ]
    );
    await client.query(
      `INSERT INTO hris.employment_history
         (employee_id, change_type, effective_date, prev_employment_status,
          new_employment_status, reason, recorded_by)
       VALUES ($1, 'contract_activated', $2, $3, $4, $5, $6)`,
      [
        contract.employee_id,
        contract.start_date,
        employee?.employment_status ?? null,
        newStatus,
        `Kontrak ${contract.contract_number} (${contract.contract_type.toUpperCase()}) aktif`,
        recorder?.id ?? null,
      ]
    );

    // EPIC-008 Fase C: sinkronkan snapshot gaji kontrak → struktur gaji
    // payroll (versi baru hris.employee_salary) agar dua sumber gaji tidak
    // menyimpang. Hanya bila kontrak mencantumkan gaji pokok.
    const contractBase =
      contract.base_salary !== null ? Number(contract.base_salary) : null;
    if (contractBase !== null && contractBase > 0) {
      const { rows } = await client.query(
        `SELECT * FROM hris.employee_salary
         WHERE employee_id = $1 AND is_active = true
         ORDER BY effective_date DESC LIMIT 1`,
        [contract.employee_id]
      );
      const current = rows[0];
      if (!current || Number(current.base_salary) !== contractBase) {
        if (current) {
          await client.query(
            `UPDATE hris.employee_salary
             SET is_active = false,
                 end_date = ($2::date - INTERVAL '1 day')::date,
                 updated_at = now()
             WHERE id = $1`,
            [current.id, contract.start_date]
          );
        }
        // Tunjangan/PTKP/flag BPJS dibawa dari versi sebelumnya (kontrak
        // hanya menyimpan gaji pokok); karyawan baru memakai default tabel.
        await client.query(
          `INSERT INTO hris.employee_salary
             (employee_id, base_salary, fixed_allowance, variable_allowance,
              transport_allowance, meal_allowance, housing_allowance,
              loan_deduction, other_deduction, ptkp_status, is_taxable,
              bpjs_tk_enrolled, bpjs_kes_enrolled, tapera_enrolled,
              effective_date, is_active, notes)
           VALUES ($1, $2,
                   COALESCE($3, 0), COALESCE($4, 0), COALESCE($5, 0),
                   COALESCE($6, 0), COALESCE($7, 0),
                   COALESCE($8, 0), COALESCE($9, 0),
                   COALESCE($10, 'TK/0'), COALESCE($11, true),
                   COALESCE($12, true), COALESCE($13, true), COALESCE($14, true),
                   $15::date, true, $16)
           ON CONFLICT (employee_id, effective_date) DO UPDATE SET
             base_salary = EXCLUDED.base_salary,
             is_active = true,
             end_date = NULL,
             notes = EXCLUDED.notes,
             updated_at = now()`,
          [
            contract.employee_id,
            contractBase,
            current?.fixed_allowance ?? null,
            current?.variable_allowance ?? null,
            current?.transport_allowance ?? null,
            current?.meal_allowance ?? null,
            current?.housing_allowance ?? null,
            current?.loan_deduction ?? null,
            current?.other_deduction ?? null,
            current?.ptkp_status ?? null,
            current?.is_taxable ?? null,
            current?.bpjs_tk_enrolled ?? null,
            current?.bpjs_kes_enrolled ?? null,
            current?.tapera_enrolled ?? null,
            contract.start_date,
            `Sinkron dari kontrak ${contract.contract_number}`,
          ]
        );
      }
    }
  });

  return NextResponse.json({ message: `Kontrak ${contract.contract_number} diaktifkan` });
}

async function end(contract: ContractRow, body: PatchBody) {
  if (contract.status !== "active") {
    return NextResponse.json(
      { error: "Hanya kontrak aktif yang bisa diakhiri" },
      { status: 409 }
    );
  }
  const actualEnd =
    body.end_date ?? contract.end_date ?? new Date().toISOString().slice(0, 10);
  const compensation =
    contract.contract_type === "pkwt"
      ? computeKompensasi(Number(contract.base_salary ?? 0), contract.start_date, actualEnd)
      : null;

  await queryOne(
    `UPDATE hris.employment_contracts
     SET status = 'ended', end_date = $2, compensation_amount = $3
     WHERE id = $1 RETURNING id`,
    [contract.id, actualEnd, compensation]
  );

  return NextResponse.json({
    message: `Kontrak ${contract.contract_number} berakhir`,
    compensation_amount: compensation,
  });
}

async function terminate(contract: ContractRow, body: PatchBody) {
  if (contract.status !== "draft" && contract.status !== "active") {
    return NextResponse.json(
      { error: "Kontrak sudah tidak berjalan" },
      { status: 409 }
    );
  }
  if (!body.reason?.trim()) {
    return NextResponse.json(
      { error: "Alasan pemutusan kontrak wajib diisi" },
      { status: 400 }
    );
  }
  // PKWT diputus lebih awal: kompensasi tetap pro-rata masa kerja berjalan
  const today = new Date().toISOString().slice(0, 10);
  const compensation =
    contract.contract_type === "pkwt" && contract.status === "active"
      ? computeKompensasi(Number(contract.base_salary ?? 0), contract.start_date, today)
      : null;

  await queryOne(
    `UPDATE hris.employment_contracts
     SET status = 'terminated', terminated_reason = $2, compensation_amount = $3
     WHERE id = $1 RETURNING id`,
    [contract.id, body.reason.trim(), compensation]
  );

  return NextResponse.json({
    message: `Kontrak ${contract.contract_number} diputus`,
    compensation_amount: compensation,
  });
}

async function convert(contract: ContractRow) {
  if (contract.status !== "active" || contract.contract_type !== "pkwt") {
    return NextResponse.json(
      { error: "Hanya kontrak PKWT aktif yang bisa dikonversi ke PKWTT" },
      { status: 409 }
    );
  }
  await queryOne(
    `UPDATE hris.employment_contracts SET status = 'converted' WHERE id = $1 RETURNING id`,
    [contract.id]
  );
  return NextResponse.json({
    message: `Kontrak ${contract.contract_number} ditandai konversi — buat kontrak PKWTT baru untuk karyawan ini`,
  });
}

/**
 * Perpanjang PKWT: buat draft kontrak lanjutan (mulai = sehari setelah kontrak
 * lama berakhir) dalam rantai parent_contract_id. Batas total 5 tahun
 * divalidasi ulang di sini. Kontrak lama tetap aktif sampai tanggalnya;
 * draft baru diaktifkan setelah kontrak lama diakhiri.
 */
async function renew(contract: ContractRow, body: PatchBody, createdByName: string) {
  if (contract.status !== "active" || contract.contract_type !== "pkwt") {
    return NextResponse.json(
      { error: "Hanya kontrak PKWT aktif yang bisa diperpanjang" },
      { status: 409 }
    );
  }
  if (!body.end_date) {
    return NextResponse.json(
      { error: "Tanggal berakhir kontrak perpanjangan wajib diisi" },
      { status: 400 }
    );
  }

  const startDate = new Date(`${contract.end_date}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() + 1);
  const newStart = startDate.toISOString().slice(0, 10);
  if (body.end_date <= newStart) {
    return NextResponse.json(
      { error: `Tanggal berakhir perpanjangan harus setelah ${newStart}` },
      { status: 400 }
    );
  }

  const chain = await query<{ start_date: string; end_date: string | null }>(
    `SELECT start_date, end_date FROM hris.employment_contracts
     WHERE employee_id = $1 AND contract_type = 'pkwt' AND status <> 'draft'`,
    [contract.employee_id]
  );
  const totalError = validatePkwtTotal(
    pkwtChainTotalMonths(chain),
    monthsWorked(newStart, body.end_date)
  );
  if (totalError) {
    return NextResponse.json({ error: totalError }, { status: 422 });
  }

  const created = await withContractNumber("pkwt", (contractNumber) =>
    queryOne<{ contract_number: string }>(
      `INSERT INTO hris.employment_contracts
         (employee_id, contract_number, contract_type, start_date, end_date,
          parent_contract_id, sequence, position_title, department_name,
          work_location, base_salary, created_by_name)
       VALUES ($1,$2,'pkwt',$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING contract_number`,
      [
        contract.employee_id,
        contractNumber,
        newStart,
        body.end_date,
        contract.id,
        contract.sequence + 1,
        contract.position_title,
        contract.department_name,
        contract.work_location,
        contract.base_salary,
        createdByName,
      ]
    )
  );

  return NextResponse.json(
    {
      message: `Draft perpanjangan ${created?.contract_number} dibuat (mulai ${newStart}) — aktifkan setelah kontrak berjalan berakhir`,
    },
    { status: 201 }
  );
}

/**
 * Edit isi draft kontrak — tipe kontrak TIDAK bisa diubah (nomor kontrak
 * mengikat tipe; hapus draft lalu buat ulang bila salah tipe). Field yang
 * tidak dikirim (undefined) dipertahankan; null mengosongkan. Seluruh aturan
 * compliance divalidasi ulang atas hasil gabungan.
 */
async function editDraft(contract: ContractRow, body: PatchBody) {
  if (contract.status !== "draft") {
    return NextResponse.json(
      { error: "Hanya kontrak berstatus draft yang bisa diedit" },
      { status: 409 }
    );
  }

  const merged = {
    start_date: body.start_date !== undefined ? body.start_date : contract.start_date,
    end_date: body.end_date !== undefined ? body.end_date : contract.end_date,
    probation_end_date:
      body.probation_end_date !== undefined
        ? body.probation_end_date
        : contract.probation_end_date,
    position_title:
      body.position_title !== undefined ? body.position_title : contract.position_title,
    work_location:
      body.work_location !== undefined ? body.work_location : contract.work_location,
    base_salary: body.base_salary !== undefined ? body.base_salary : contract.base_salary,
    notes: body.notes !== undefined ? body.notes : contract.notes,
  };
  if (!merged.start_date) {
    return NextResponse.json({ error: "Tanggal mulai wajib diisi" }, { status: 400 });
  }
  if (merged.base_salary !== null && merged.base_salary !== undefined) {
    const salary = Number(merged.base_salary);
    if (!Number.isFinite(salary) || salary < 0) {
      return NextResponse.json({ error: "Gaji pokok tidak valid" }, { status: 400 });
    }
  }

  const dateErrors = validateContractDates({
    contract_type: contract.contract_type,
    start_date: merged.start_date,
    end_date: merged.end_date,
    probation_end_date: merged.probation_end_date,
  });
  if (dateErrors.length > 0) {
    return NextResponse.json({ error: dateErrors.join(" ") }, { status: 400 });
  }

  // Batas total PKWT 5 tahun — sama seperti saat pembuatan draft
  if (contract.contract_type === "pkwt") {
    const chain = await query<{ start_date: string; end_date: string | null }>(
      `SELECT start_date, end_date FROM hris.employment_contracts
       WHERE employee_id = $1 AND contract_type = 'pkwt' AND status <> 'draft'`,
      [contract.employee_id]
    );
    const totalError = validatePkwtTotal(
      pkwtChainTotalMonths(chain),
      monthsWorked(merged.start_date, merged.end_date ?? merged.start_date)
    );
    if (totalError) {
      return NextResponse.json({ error: totalError }, { status: 422 });
    }
  }

  // guard status di UPDATE — draft bisa keburu diaktifkan request lain
  const updated = await queryOne<{ id: string }>(
    `UPDATE hris.employment_contracts
     SET start_date         = $2,
         end_date           = $3,
         probation_end_date = $4,
         position_title     = $5,
         work_location      = $6,
         base_salary        = $7,
         notes              = $8
     WHERE id = $1 AND status = 'draft' RETURNING id`,
    [
      contract.id,
      merged.start_date,
      merged.end_date,
      merged.probation_end_date,
      merged.position_title,
      merged.work_location,
      merged.base_salary,
      merged.notes,
    ]
  );
  if (!updated) {
    return NextResponse.json(
      { error: "Kontrak sudah bukan draft — muat ulang halaman" },
      { status: 409 }
    );
  }

  return NextResponse.json({ message: `Draft kontrak ${contract.contract_number} diperbarui` });
}

// Field yang tidak dikirim (undefined) dipertahankan; null mengosongkan —
// supaya tanggal administrasi yang salah isi bisa dikoreksi/dihapus.
async function updateMeta(contract: ContractRow, body: PatchBody) {
  const merged = {
    signed_at: body.signed_at !== undefined ? body.signed_at : contract.signed_at,
    signed_document_url:
      body.signed_document_url !== undefined ? body.signed_document_url : undefined,
    kemnaker_registered_at:
      body.kemnaker_registered_at !== undefined
        ? body.kemnaker_registered_at
        : contract.kemnaker_registered_at,
    compensation_paid_at:
      body.compensation_paid_at !== undefined
        ? body.compensation_paid_at
        : contract.compensation_paid_at,
    notes: body.notes !== undefined ? body.notes : contract.notes,
  };

  await queryOne(
    `UPDATE hris.employment_contracts
     SET signed_at              = $2::date,
         signed_document_url    = COALESCE($3, signed_document_url),
         kemnaker_registered_at = $4::date,
         compensation_paid_at   = $5::date,
         notes                  = $6
     WHERE id = $1 RETURNING id`,
    [
      contract.id,
      merged.signed_at,
      merged.signed_document_url ?? null,
      merged.kemnaker_registered_at,
      merged.compensation_paid_at,
      merged.notes,
    ]
  );
  return NextResponse.json({ message: "Kontrak diperbarui" });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID kontrak tidak valid" }, { status: 400 });
    }
    const deleted = await queryOne<{ id: string }>(
      `DELETE FROM hris.employment_contracts
       WHERE id = $1 AND status = 'draft' RETURNING id`,
      [id]
    );
    if (!deleted) {
      return NextResponse.json(
        { error: "Hanya draft kontrak yang bisa dihapus" },
        { status: 409 }
      );
    }
    return NextResponse.json({ message: "Draft kontrak dihapus" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[contracts] DELETE failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
