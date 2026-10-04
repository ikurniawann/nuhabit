import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { buildPayslipPdf, payslipFileName } from "@/lib/hris/payslip-pdf";
import { requireUuid, requireWorkforceActor } from "@/lib/hris/workforce-route";
import { loadPayslipPdfRow, payslipAmounts } from "@/lib/payroll/payslips";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSettings, SETTING_KEYS } from "@/lib/settings/app-settings";

/**
 * GET /api/hris/payslips/[id]/pdf: slip gaji sebagai berkas PDF.
 *
 * Digenerate on-the-fly dari `payroll_details`, snapshot saat payroll
 * dihitung, jadi mengunduh ulang tahun depan menghasilkan angka yang sama.
 * Kepemilikan diperiksa di server: karyawan hanya boleh mengunduh slipnya
 * sendiri; tanpa ini mengganti UUID di URL cukup untuk membaca gaji orang lain.
 */
export const GET = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const actor = await requireWorkforceActor();
    const id = requireUuid((await params).id, "ID slip tidak valid");

    if (!checkRateLimit(`payslip_pdf_${actor.userId}`, 30).allowed) {
      throw ApiError.tooManyRequests("Terlalu banyak permintaan, coba lagi sebentar lagi");
    }

    const row = await loadPayslipPdfRow(id);
    if (!row) throw ApiError.notFound("Slip gaji tidak ditemukan");
    // Karyawan biasa hanya boleh slipnya sendiri; HR boleh semua.
    if (!actor.isHr && row.employee_id !== actor.employeeId) {
      throw ApiError.forbidden("Insufficient permissions");
    }

    const settings = await getSettings([
      SETTING_KEYS.COMPANY_LEGAL_NAME,
      SETTING_KEYS.COMPANY_ADDRESS,
      SETTING_KEYS.COMPANY_CITY,
    ]).catch(() => ({}) as Record<string, string | null>);

    const period = {
      month: Number(row.period_month),
      year: Number(row.period_year),
      paid_at: row.paid_at,
      status: row.run_status,
    };
    const pdf = await buildPayslipPdf({
      company: {
        legal_name: settings[SETTING_KEYS.COMPANY_LEGAL_NAME] ?? null,
        address: settings[SETTING_KEYS.COMPANY_ADDRESS] ?? null,
        city: settings[SETTING_KEYS.COMPANY_CITY] ?? null,
      },
      employee: {
        full_name: row.full_name,
        nip: row.nip,
        position_title: row.position_title,
        department_name: row.department_name,
      },
      period,
      amounts: payslipAmounts(row),
    });

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `attachment; filename="${payslipFileName(row.full_name, period)}"`,
        // Slip memuat data gaji: jangan sampai tersimpan di cache bersama.
        "Cache-Control": "no-store, private",
      },
    });
  },
  "hris/payslips/[id]/pdf.GET"
);
