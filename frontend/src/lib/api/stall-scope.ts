import { getUser } from "@/lib/auth/require-user";

/**
 * Stall aktif untuk API route.
 * - `all`  → tampilkan agregat seluruh stall (mode "Semua Stall").
 * - `stall`→ batasi ke satu stall.
 */
export type ApiStallScope =
  | { mode: "all" }
  | { mode: "stall"; warehouseId: string };

/**
 * Stall aktif untuk API, memakai resolusi yang sama persis dengan sidebar
 * (`getUser`) — termasuk fallback ke penempatan user saat cookie kosong dan
 * penolakan cookie di luar akses. Tanpa ini header sidebar bisa menulis
 * "Yakitori Stall" sementara tabel menampilkan data semua stall.
 *
 * Filter ini hanya mempersempit data yang sudah boleh dilihat user (scope
 * company/branch tetap berlaku di masing-masing query), jadi bukan pengganti
 * otorisasi.
 */
export async function getApiStallScope(): Promise<ApiStallScope> {
  const { user } = await getUser();
  const warehouseId = user?.active_stall_id ?? null;
  return warehouseId ? { mode: "stall", warehouseId } : { mode: "all" };
}

/**
 * `warehouse_id` efektif untuk endpoint yang sudah menerima filter gudang:
 * param eksplisit menang (mis. picker POS / laporan yang memilih gudang
 * sendiri), selain itu ikut stall aktif di sidebar. `null` = semua stall.
 */
export async function resolveWarehouseFilter(
  explicit?: string | null
): Promise<string | null> {
  if (explicit) return explicit;
  const scope = await getApiStallScope();
  return scope.mode === "stall" ? scope.warehouseId : null;
}

/**
 * Sumber data stok bahan baku sesuai stall aktif.
 *
 * `v_raw_materials_stock` menjumlahkan seluruh gudang, jadi tidak bisa dipakai
 * saat satu stall dipilih; view berdimensi warehouse dipakai sebagai gantinya
 * dan hasilnya difilter lewat `warehouseId`.
 */
export async function rawMaterialStockSource(): Promise<{
  view: "v_raw_materials_stock" | "v_raw_materials_stock_by_warehouse";
  warehouseId: string | null;
}> {
  const scope = await getApiStallScope();
  return scope.mode === "stall"
    ? { view: "v_raw_materials_stock_by_warehouse", warehouseId: scope.warehouseId }
    : { view: "v_raw_materials_stock", warehouseId: null };
}
