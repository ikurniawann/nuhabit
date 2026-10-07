import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { queryOne } from "@/lib/db";
import { assertInvoiceAccess } from "@/lib/finance/invoices";
import { INVOICE_VIEWER_ROLES, requireFinanceUser, type FinanceUser } from "@/lib/finance/server";
import { deletePrivateFile, readPrivateFile, savePrivateDocument } from "@/lib/storage-private";

/**
 * Lampiran Faktur Pajak per invoice (EPIC-025) — dokumen pajak resmi
 * terpisah dari PDF invoice internal. Satu lampiran per invoice (pola
 * signed_document_url kontrak EPIC-006): re-upload menimpa file lama.
 *   POST   unggah (PDF/JPG/PNG/WebP, maks 10 MB) — finance-only
 *   GET    sajikan file (inline, ber-auth) — sales boleh lihat, tak bisa ubah
 *   DELETE hapus lampiran — finance-only
 */

const MAX_BYTES = 10 * 1024 * 1024;
const NO_ATTACHMENT = "Invoice ini belum punya lampiran faktur pajak";

type RouteContext = { params: Promise<{ id: string }> };

async function loadInvoice(id: string, user: FinanceUser) {
  return assertInvoiceAccess(
    await queryOne<{ id: string; deal_id: string; invoice_number: string; faktur_pajak_url: string | null }>(
      `SELECT id, deal_id, invoice_number, faktur_pajak_url
       FROM crm.crm_sales_invoices WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    ),
    user
  );
}

async function readUploadedFile(request: NextRequest): Promise<File> {
  const formData = await request.formData().catch(() => {
    throw ApiError.badRequest("Form data tidak valid");
  });
  const file = formData.get("file");
  if (!(file instanceof File)) throw ApiError.badRequest("File tidak ditemukan");
  if (file.size > MAX_BYTES) throw ApiError.badRequest("Ukuran dokumen maksimal 10 MB");
  return file;
}

export const POST = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireFinanceUser();
  const invoice = await loadInvoice((await params).id, user);
  const file = await readUploadedFile(request);

  const saved = await savePrivateDocument(
    Buffer.from(await file.arrayBuffer()),
    `invoice-faktur-pajak/${invoice.deal_id}`
  );
  if (!saved.path) {
    throw ApiError.badRequest(saved.error ?? "Gagal menyimpan dokumen — pastikan PDF/JPG/PNG/WebP");
  }

  await queryOne(
    `UPDATE crm.crm_sales_invoices SET faktur_pajak_url = $2, updated_at = now() WHERE id = $1 RETURNING id`,
    [invoice.id, saved.path]
  );
  if (invoice.faktur_pajak_url) await deletePrivateFile(invoice.faktur_pajak_url);

  return NextResponse.json({ success: true, message: `Faktur pajak ${invoice.invoice_number} tersimpan` });
}, "POST /api/finance/invoices/[id]/faktur-pajak");

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const user = await requireFinanceUser(INVOICE_VIEWER_ROLES);
  const invoice = await loadInvoice((await params).id, user);
  if (!invoice.faktur_pajak_url) throw ApiError.notFound(NO_ATTACHMENT);

  const { data, mime } = await readPrivateFile(invoice.faktur_pajak_url);
  if (!data) throw ApiError.notFound("File tidak ditemukan");
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": mime ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="faktur-pajak-${invoice.invoice_number.replace(/[^a-zA-Z0-9.-]/g, "_")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}, "GET /api/finance/invoices/[id]/faktur-pajak");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const user = await requireFinanceUser();
  const invoice = await loadInvoice((await params).id, user);
  if (!invoice.faktur_pajak_url) throw ApiError.conflict(NO_ATTACHMENT);

  await queryOne(
    `UPDATE crm.crm_sales_invoices SET faktur_pajak_url = NULL, updated_at = now() WHERE id = $1 RETURNING id`,
    [invoice.id]
  );
  await deletePrivateFile(invoice.faktur_pajak_url);
  return NextResponse.json({ success: true, message: "Lampiran faktur pajak dihapus" });
}, "DELETE /api/finance/invoices/[id]/faktur-pajak");
