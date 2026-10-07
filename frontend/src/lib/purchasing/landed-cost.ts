import { query } from "@/lib/db";
import {
  AccountingPostError,
  postJournalFromMapping,
  type JournalAmountBag,
  type MappingPostResult,
} from "@/lib/accounting/journal-mapping-posting";
import { todayJakarta } from "@/lib/inventory/batches";

/*
 * Biaya tambahan pembelian (purchasing.cogs_additional_costs) masuk ke nilai
 * stok bahan baku yang dibawa dokumennya lewat inventory.apply_landed_costs
 * (migrasi 20261005202000), lalu dijurnal PURCHASE_LANDED_COST atau
 * PURCHASE_LANDED_COST_REVERSAL per batch. Sama dengan Go:
 * internal/modules/inventory/ledger/landed_cost.go dan
 * internal/modules/accounting (PostLandedCost, domain.LandedCostAmounts).
 */

const round2 = (v: number) => Math.round(v * 100) / 100;

function amountBag(stock: number, cogs: number): JournalAmountBag | null {
  const inventory = round2(Math.max(stock, 0));
  const expensed = round2(Math.max(cogs, 0));
  if (inventory + expensed <= 0) return null;
  const bag: JournalAmountBag = {};
  if (inventory > 0) bag.SUBTOTAL = inventory;
  if (expensed > 0) bag.COGS = expensed;
  bag.TOTAL = round2(inventory + expensed);
  return bag;
}

/**
 * Bagian positif sebuah batch (SUBTOTAL ke inventory, COGS yang dibebankan)
 * untuk PURCHASE_LANDED_COST dan bagian negatifnya untuk reversal; TOTAL
 * adalah sisi AP. null bila tidak ada yang dijurnal.
 */
export function landedCostAmounts(capitalized: number, expensed: number) {
  return { post: amountBag(capitalized, expensed), reverse: amountBag(-capitalized, -expensed) };
}

type AppliedBatch = {
  batch_id: string;
  cost_id: string;
  company_id: string | null;
  capitalized: number;
  expensed: number;
};

const JOURNALS = [
  { eventCode: "PURCHASE_LANDED_COST", label: "kapitalisasi ke inventory", side: "post" },
  { eventCode: "PURCHASE_LANDED_COST_REVERSAL", label: "pembalikan dari inventory", side: "reverse" },
] as const;

/**
 * Alokasikan biaya (yang disebut, aktif atau baru dihapus, plus biaya aktif
 * di GRN yang disebut dan PO-nya) ke stok yang sudah diposting, lalu jurnal
 * tiap batch. Jurnal yang gagal dicatat di log; perubahan stok tetap.
 */
export async function capitalizeLandedCosts(opts: {
  costIds?: string[];
  grnIds?: string[];
  userId: string;
}): Promise<MappingPostResult[]> {
  const batches = await query<AppliedBatch>(
    `SELECT batch_id::text AS batch_id, cost_id::text AS cost_id, company_id::text AS company_id,
            capitalized::float8 AS capitalized, expensed::float8 AS expensed
       FROM inventory.apply_landed_costs($1::uuid[], $2::uuid[], $3::uuid)`,
    [opts.costIds ?? [], opts.grnIds ?? [], opts.userId]
  );
  const entryDate = todayJakarta();
  const results: MappingPostResult[] = [];
  for (const batch of batches) {
    const bags = landedCostAmounts(batch.capitalized, batch.expensed);
    for (const journal of JOURNALS) {
      const amounts = bags[journal.side];
      if (!amounts) continue;
      try {
        results.push(
          await postJournalFromMapping({
            companyId: batch.company_id,
            userId: opts.userId,
            eventCode: journal.eventCode,
            documentType: "landed_cost",
            documentId: batch.batch_id,
            entryDate,
            amounts,
            sourceModule: "PURCHASING",
            description: `Biaya tambahan pembelian — ${journal.label}`,
          })
        );
      } catch (err) {
        if (!(err instanceof AccountingPostError)) throw err;
        console.error("[landed-cost] Jurnal tidak terposting:", err.message);
      }
    }
  }
  return results;
}
