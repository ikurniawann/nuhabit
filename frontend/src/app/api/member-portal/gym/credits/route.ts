import { withTransaction } from "@/lib/db";
import { loadCreditWallet } from "@/lib/gym/credits-server";
import { memberJson, withMemberSession } from "@/lib/member-portal/route";

/**
 * GET — saldo kredit kelas, lot (sisa + kedaluwarsa), kredit yang segera
 * kedaluwarsa, dan 50 riwayat terakhir. Kredit lewat masa berlaku dicatat dulu.
 */
export const GET = withMemberSession("Gagal memuat kredit kelas", async (customerId) => {
  const wallet = await withTransaction((client) => loadCreditWallet(client, customerId, 50));
  return memberJson({
    ...wallet,
    lots: wallet.lots.filter((lot) => lot.remaining > 0 && !lot.expired),
    // Nama staf tidak dibuka ke member.
    entries: wallet.entries.map((entry) => ({ ...entry, created_by_name: null })),
  });
});
