// Deskripsi ledger XP lama menyimpan UUID internal (owner 2026-08-31).
// Fungsi ini menampilkan nomor order kasir / nominal topup sebagai gantinya.
// Baris baru sudah manusiawi sejak ditulis (loyalty-pos-earn); pemetaan ini
// menutup riwayat lama tanpa migrasi data.
import { formatRupiah } from "@/lib/format";

export interface LedgerDescriptionRow {
  description: string | null;
  reference_table: string | null;
  reference_id: string | null;
  metadata: { amount?: number | string } | null;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** ID order yang perlu dicari nomornya (baris ledger order). */
export function ledgerOrderIds(rows: LedgerDescriptionRow[]): string[] {
  return [
    ...new Set(
      rows
        .filter((row) => row.reference_table === "pos_orders" && row.reference_id)
        .map((row) => row.reference_id as string)
    ),
  ];
}

export function humanizeLedgerDescription(
  row: LedgerDescriptionRow,
  orderNumbers: ReadonlyMap<string, string>
): string {
  const desc = row.description ?? "";
  const uuid = desc.match(UUID_RE)?.[0];
  if (!uuid) return desc;
  const prefix = desc.split(/ untuk /)[0] || desc.replace(UUID_RE, "").trim();
  if (row.reference_table === "pos_orders" && row.reference_id) {
    const num = orderNumbers.get(row.reference_id);
    return `${prefix} — order ${num ? `#${num}` : row.reference_id.slice(0, 8)}`;
  }
  const amount = Number(row.metadata?.amount);
  if (Number.isFinite(amount) && amount > 0) return `${prefix} — ${formatRupiah(amount)}`;
  return desc.replace(UUID_RE, uuid.slice(0, 8));
}
