import {
  evaluateOfferRules,
  expandCategoryTargets,
  type AppliedOffer,
  type OfferCartLine,
  type OfferEvalRule,
} from "@/lib/promo/offer-evaluate";
import {
  findOfferByUnlockCode,
  listActiveOfferRules,
  loadCategoryProductMap,
  toOfferEvalRules,
  type OfferRuleDetail,
} from "@/lib/promo/offer-rules-server";

export function todayJakartaIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Aturan aktif siap evaluasi: target kategori sudah dijabarkan ke produk.
 * Endpoint kasir dan pembuatan order memakai fungsi ini supaya diskon klien
 * dan server dihitung dari aturan yang identik.
 */
export async function loadActiveOfferEvalRules(input: {
  companyId: string;
  branchId: string;
  customerId?: string | null;
}): Promise<{ details: OfferRuleDetail[]; rules: OfferEvalRule[] }> {
  const details = await listActiveOfferRules({
    companyId: input.companyId,
    branchId: input.branchId,
    todayIsoDate: todayJakartaIso(),
    customerId: input.customerId,
  });
  if (details.length === 0) return { details, rules: [] };
  const rules = expandCategoryTargets(
    toOfferEvalRules(details),
    await loadCategoryProductMap(details)
  );
  return { details, rules };
}

/**
 * Evaluasi penawaran aktif utk keranjang kasir (server-side). `code` =
 * kode yang diketik kasir: bila cocok dgn kode pembuka penawaran, aturan
 * itu ikut aktif dan `unlocked_rule_id` terisi (pemanggil TIDAK lagi
 * memperlakukannya sbg kode campaign promo).
 */
export async function evaluateActiveOffersForPosCart(input: {
  companyId: string | null | undefined;
  branchId: string | null | undefined;
  items: OfferCartLine[];
  code?: string | null;
  customerId?: string | null;
}): Promise<{
  offer_discount: number;
  applied: AppliedOffer[];
  unlocked_rule_id: string | null;
}> {
  const empty = { offer_discount: 0, applied: [] as AppliedOffer[], unlocked_rule_id: null };
  if (!input.companyId || !input.branchId) return empty;

  const unlocked = input.code
    ? await findOfferByUnlockCode({
        companyId: input.companyId,
        branchId: input.branchId,
        code: input.code,
        todayIsoDate: todayJakartaIso(),
      })
    : null;
  if (input.items.length === 0) return { ...empty, unlocked_rule_id: unlocked?.id ?? null };

  const { rules } = await loadActiveOfferEvalRules({
    companyId: input.companyId,
    branchId: input.branchId,
    customerId: input.customerId,
  });
  const result = evaluateOfferRules(input.items, rules, {
    channel: "pos",
    unlockedRuleIds: unlocked ? [unlocked.id] : [],
  });
  return { ...result, unlocked_rule_id: unlocked?.id ?? null };
}
