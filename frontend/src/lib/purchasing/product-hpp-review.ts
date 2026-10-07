export const HPP_REVIEW_THRESHOLD = 1;

type NumericLike = number | string | null | undefined;

export type ProductHppReviewSource = {
  harga_modal?: NumericLike;
  hpp_estimasi?: NumericLike;
  estimated_cogs?: NumericLike;
  total_bahan_baku?: NumericLike;
};

export type ProductHppReview = {
  harga_modal: number;
  hpp_estimasi: number;
  hpp_tersimpan: number;
  hpp_resep: number;
  hpp_selisih: number;
  hpp_perlu_review: boolean;
};

function toNumber(value: NumericLike) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function buildProductHppReview(
  source: ProductHppReviewSource
): ProductHppReview {
  const hargaModal = toNumber(source.harga_modal);
  const hppEstimasi = toNumber(source.hpp_estimasi ?? source.estimated_cogs);
  const totalBahan = toNumber(source.total_bahan_baku);
  const hppTersimpan = Math.round(hargaModal);
  const hppResep = Math.round(hppEstimasi);
  const hppSelisih = hppResep - hppTersimpan;
  const hppPerluReview =
    totalBahan > 0 &&
    hppResep > 0 &&
    Math.abs(hppSelisih) >= HPP_REVIEW_THRESHOLD;

  return {
    harga_modal: hargaModal,
    hpp_estimasi: hppEstimasi,
    hpp_tersimpan: hppTersimpan,
    hpp_resep: hppResep,
    hpp_selisih: hppSelisih,
    hpp_perlu_review: hppPerluReview,
  };
}

export function withProductHppReview<T extends ProductHppReviewSource>(
  product: T
): T & ProductHppReview {
  return {
    ...product,
    ...buildProductHppReview(product),
  };
}
