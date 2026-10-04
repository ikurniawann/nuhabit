import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSettings, SETTING_KEYS } from "@/lib/settings/app-settings";
import {
  buildContractPdf,
  contractFileName,
  type ContractDocumentData,
} from "@/lib/hris/contract-pdf";

/**
 * GET /api/hris/contracts/[id]/document — PDF surat perjanjian kerja
 * (PKWT/PKWTT). Digenerate on-the-fly dari snapshot kontrak + profil
 * perusahaan (app_settings company_*); nilai kosong dirender sebagai
 * garis isian sehingga draft tetap bisa dicetak.
 */

const ROLES = ["super_admin", "admin", "hrd"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID kontrak tidak valid" }, { status: 400 });
    }
    if (!checkRateLimit(`contract_pdf_${user.id}`, 30).allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }

    const row = await queryOne<{
      contract_number: string;
      contract_type: "pkwt" | "pkwtt";
      start_date: string;
      end_date: string | null;
      probation_end_date: string | null;
      position_title: string | null;
      department_name: string | null;
      work_location: string | null;
      base_salary: string | null;
      signed_at: string | null;
      full_name: string;
      ktp: string | null;
      address: string | null;
      city: string | null;
      birth_date: string | null;
      phone: string | null;
    }>(
      `SELECT c.contract_number, c.contract_type, c.start_date, c.end_date,
              c.probation_end_date, c.position_title, c.department_name,
              c.work_location, c.base_salary, c.signed_at,
              e.full_name, e.ktp, e.address, e.city, e.birth_date, e.phone
       FROM hris.employment_contracts c
       JOIN hris.employees e ON e.id = c.employee_id
       WHERE c.id = $1`,
      [id]
    );
    if (!row) {
      return NextResponse.json({ error: "Kontrak tidak ditemukan" }, { status: 404 });
    }

    const settings = await getSettings([
      SETTING_KEYS.COMPANY_LEGAL_NAME,
      SETTING_KEYS.COMPANY_ADDRESS,
      SETTING_KEYS.COMPANY_CITY,
      SETTING_KEYS.COMPANY_SIGNER_NAME,
      SETTING_KEYS.COMPANY_SIGNER_TITLE,
    ]);

    const data: ContractDocumentData = {
      company: {
        legal_name: settings[SETTING_KEYS.COMPANY_LEGAL_NAME],
        address: settings[SETTING_KEYS.COMPANY_ADDRESS],
        city: settings[SETTING_KEYS.COMPANY_CITY],
        signer_name: settings[SETTING_KEYS.COMPANY_SIGNER_NAME],
        signer_title: settings[SETTING_KEYS.COMPANY_SIGNER_TITLE],
      },
      employee: {
        full_name: row.full_name,
        ktp: row.ktp,
        address: [row.address, row.city].filter(Boolean).join(", ") || null,
        birth_date: row.birth_date,
        phone: row.phone,
      },
      contract: {
        contract_number: row.contract_number,
        contract_type: row.contract_type,
        start_date: row.start_date,
        end_date: row.end_date,
        probation_end_date: row.probation_end_date,
        position_title: row.position_title,
        department_name: row.department_name,
        work_location: row.work_location,
        base_salary: row.base_salary ? Number(row.base_salary) : null,
        signed_at: row.signed_at,
      },
    };

    const pdf = await buildContractPdf(data);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `attachment; filename="${contractFileName(row.contract_number, row.full_name)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[contract-pdf] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
