import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { parseContractListParams } from "@/lib/hris/contracts-list";
import { listContracts } from "@/lib/hris/contracts-repo";

/**
 * GET /api/hris/contracts — daftar kontrak karyawan lintas karyawan
 * (halaman HRIS → Kontrak). Filter: status, tipe, cari nama/nomor,
 * days=N (hanya yang berakhir ≤ N hari, termasuk yang sudah lewat).
 * Sort whitelist di lib/hris/contracts-list.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const params = parseContractListParams(req.nextUrl.searchParams);
  const { rows, total } = await listContracts(params);
  return NextResponse.json({ data: rows, total, page: params.page, limit: params.limit });
}, "hris/contracts GET");
