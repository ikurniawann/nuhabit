import type { DbClient } from "@/lib/pg/types";

/** Coerce Postgres numeric (often returned as string) to a finite number. */
export function toQty(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build a compact daily document prefix: PREFIX-YYYYMMDD.
 */
function getDailyPrefix(prefix: string, date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${prefix}-${year}${month}${day}`;
}

function getNextSequenceFromDocumentNumber(
  documentNumber: string | null | undefined
): number {
  if (!documentNumber) return 1;

  const sequence = Number.parseInt(documentNumber.split("-").at(-1) || "", 10);
  return Number.isFinite(sequence) ? sequence + 1 : 1;
}

/**
 * Generate nomor PR dengan format: PR-YYYYMMDD-NNNN
 * Contoh: PR-20260522-0001
 */
export async function generatePRNumber(
  db: DbClient
): Promise<string> {
  const prefix = getDailyPrefix("PR");
  
  // Cari PR terakhir di tanggal ini. Nomor lama tetap valid karena tidak dimigrasi.
  const { data: lastPR } = await db
    .from("purchase_requests")
    .select("pr_number")
    .ilike("pr_number", `${prefix}-%`)
    .order("pr_number", { ascending: false })
    .limit(1);
  
  const sequence = getNextSequenceFromDocumentNumber(lastPR?.[0]?.pr_number);
  
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

/**
 * Generate nomor PO dengan format: PO-YYYYMMDD-NNNN
 */
export async function generatePONumber(
  db: DbClient
): Promise<string> {
  const prefix = getDailyPrefix("PO");
  
  const { data: lastPO } = await db
    .from("purchase_orders")
    .select("nomor_po")
    .ilike("nomor_po", `${prefix}-%`)
    .order("nomor_po", { ascending: false })
    .limit(1);
  
  const sequence = getNextSequenceFromDocumentNumber(lastPO?.[0]?.nomor_po);
  
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

/**
 * Generate nomor Vendor dengan format: V-YYYY-NNNN
 */
export async function generateVendorCode(
  db: DbClient
): Promise<string> {
  const year = new Date().getFullYear();
  
  const { data: lastVendor } = await db
    .from("vendors")
    .select("code")
    .ilike("code", `V-${year}-%`)
    .order("code", { ascending: false })
    .limit(1);
  
  let sequence = 1;
  if (lastVendor && lastVendor.length > 0) {
    const lastNum = parseInt(lastVendor[0].code.split("-")[2]);
    sequence = lastNum + 1;
  }
  
  return `V-${year}-${String(sequence).padStart(4, "0")}`;
}

