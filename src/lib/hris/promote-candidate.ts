/**
 * Promosi kandidat rekrutmen (hired/talent pool) menjadi karyawan: insert
 * karyawan (NIP EMP-<tahun>-<urut>), tautkan kandidat, lalu buat draft
 * kontrak dari offer yang diterima (Fase D modul kontrak).
 */

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import type { PgClient } from "@/lib/pg/create-client";
import { draftContractFromEmploymentStatus } from "./contracts";
import { createDraftContract } from "./create-contract";
import { UUID_RE } from "./workforce-route";

const PROMOTABLE_STATUSES = ["hired", "talent_pool"];

export const promotionSchema = z.object({
  candidate_id: z.string({ error: "candidate_id wajib diisi" }).min(1, "candidate_id wajib diisi"),
  join_date: z.string().nullish(),
  employment_status: z
    .enum(["probation", "contract", "permanent", "internship"])
    .nullish(),
  department_id: z.string().regex(UUID_RE).nullish(),
  reporting_to: z.string().regex(UUID_RE).nullish(),
});

type PromotionInput = z.infer<typeof promotionSchema>;

/** NIP kandidat berikutnya yang belum dipakai: EMP-<tahun>-00001, …00002, … */
async function nextFreeNip(db: PgClient, year: number): Promise<string> {
  for (let seq = 1; seq < 99999; seq++) {
    const nip = `EMP-${year}-${String(seq).padStart(5, "0")}`;
    const { data: existing } = await db.from("employees").select("id").eq("nip", nip).maybeSingle();
    if (!existing) return nip;
  }
  throw new Error("Nomor NIP habis untuk tahun ini");
}

/**
 * Draft kontrak otomatis: tipe dari employment_status (contract → PKWT 12
 * bln; probation → PKWTT + percobaan 3 bln; permanent → PKWTT), gaji &
 * posisi dari offer terakhir yang diterima. Gagal TIDAK menggagalkan promote.
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
    console.error("[promote] auto-draft contract failed:", error);
    return {
      contractNumber: null,
      warning: "Karyawan dibuat, tetapi draft kontrak otomatis gagal — buat manual di tab Kontrak",
    };
  }
}

export async function promoteCandidate(db: PgClient, input: PromotionInput) {
  const { data: candidate } = await db
    .from("candidates")
    .select(`*, position:positions (id, title, department), brand:brands (id, name)`)
    .eq("id", input.candidate_id)
    .maybeSingle();
  if (!candidate) throw ApiError.notFound("Kandidat tidak ditemukan");
  if (candidate.promoted_to_employee_id) {
    throw ApiError.badRequest("Kandidat sudah dipromosikan menjadi employee");
  }
  if (!PROMOTABLE_STATUSES.includes(candidate.status)) {
    throw ApiError.badRequest(
      `Status kandidat harus "hired" atau "talent_pool" untuk dipromosikan. Status saat ini: ${candidate.status}`,
      { suggestion: 'Ubah status kandidat menjadi "hired" terlebih dahulu' }
    );
  }

  const joinDate = input.join_date || new Date().toISOString().split("T")[0];
  const employmentStatus = input.employment_status || "probation";

  // Fungsi DB public.promote_candidate_to_employee tidak dipakai: ia membaca
  // kolom candidates.name yang tidak ada, tidak mengisi NIP (NOT NULL),
  // reporting_to, maupun candidates.promoted_to_employee_id.
  const { data: newEmployee, error: insertError } = await db
    .from("employees")
    .insert({
      nip: await nextFreeNip(db, new Date().getFullYear()),
      full_name: candidate.full_name,
      email: candidate.email,
      phone: candidate.phone || "",
      join_date: joinDate,
      employment_status: employmentStatus,
      department_id: input.department_id || null,
      job_title_id: candidate.position?.id || null,
      reporting_to: input.reporting_to || null,
      is_active: true,
    })
    .select()
    .single();
  if (insertError) throw new Error(`Gagal membuat karyawan: ${insertError.message}`);
  const employeeId: string | null = newEmployee?.id ?? null;
  if (employeeId) {
    await db.from("candidates").update({ promoted_to_employee_id: employeeId }).eq("id", candidate.id);
  }

  const { data: employee, error: employeeError } = await db
    .from("employees")
    .select(`*, department:departments (id, name, code), job_title:positions (id, title)`)
    .eq("id", employeeId)
    .single();
  if (employeeError) console.error("[promote] gagal memuat karyawan baru:", employeeError);

  const contractDraft = employeeId
    ? await autoDraftContract(employeeId, candidate.id, joinDate, employmentStatus)
    : { contractNumber: null, warning: null };
  const contractInfo = contractDraft.contractNumber
    ? ` — draft kontrak ${contractDraft.contractNumber} dibuat otomatis`
    : contractDraft.warning
      ? ` — ${contractDraft.warning}`
      : "";

  return {
    data: employee,
    employee_id: employeeId,
    nip: employee?.nip,
    contract_number: contractDraft.contractNumber,
    message: `Berhasil mempromosikan ${candidate.full_name} menjadi karyawan${contractInfo}`,
    candidate: {
      id: candidate.id,
      full_name: candidate.full_name,
      promoted_to_employee_id: employeeId,
    },
  };
}
