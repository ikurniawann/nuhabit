import { queryOne } from "@/lib/db";
import { fireOwnerNotification } from "@/lib/wa/notifications-sender";
import {
  buildPrMendesakMessage,
  prMendesakDedupKey,
} from "@/lib/wa/notifications-messages";

/**
 * Notifikasi WA untuk Purchase Request berprioritas MENDESAK (owner
 * 2026-09-04): dikirim ke nomor penerima di Settings → Notifikasi WA
 * (jenis "Purchase Request mendesak"). Dipanggil fire-and-forget setelah
 * PR tersimpan — tidak pernah menggagalkan penyimpanan PR. Dedup per PR
 * per status: draft sekali, diajukan sekali; edit draft berulang senyap.
 */
export interface PrUrgentNotifyInput {
  prId: string;
  prNumber: string;
  priority: string;
  status: string;
  requesterName: string;
  departmentId?: string | null;
  totalAmount: number;
  requiredDate?: string | null;
  notes?: string | null;
  items: { description: string; qty: number; unit?: string | null }[];
}

export function isUrgentPriority(priority: string | null | undefined): boolean {
  return String(priority ?? "").toLowerCase() === "urgent";
}

export async function notifyPrMendesak(input: PrUrgentNotifyInput): Promise<void> {
  if (!isUrgentPriority(input.priority)) return;
  try {
    let departmentName: string | null = null;
    if (input.departmentId) {
      const dept = await queryOne<{ name: string | null }>(
        `SELECT name FROM hris.departments WHERE id = $1`,
        [input.departmentId]
      );
      departmentName = dept?.name ?? null;
    }
    fireOwnerNotification({
      type: "prMendesak",
      dedupKey: prMendesakDedupKey(input.prId, input.status),
      message: buildPrMendesakMessage({
        prNumber: input.prNumber,
        status: input.status,
        requesterName: input.requesterName,
        departmentName,
        totalAmount: input.totalAmount,
        requiredDate: input.requiredDate ?? null,
        notes: input.notes ?? null,
        items: input.items,
      }),
    });
  } catch (error) {
    console.error("[wa-notif] prMendesak gagal disiapkan:", error);
  }
}
