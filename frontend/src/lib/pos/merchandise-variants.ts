/**
 * EPIC-047 Fase 1A — matriks varian (ukuran × warna × …) di master produk
 * merchandise → auto-generate SKU. Murni (tanpa I/O); dipakai oleh
 * POST /api/pos/products/[id]/skus/matrix.
 */

export type VariantAxis = {
  key: "ukuran" | "warna" | string;
  values: string[];
};

/** Kombinasi satu baris matriks: { ukuran: "M", warna: "Hitam", ... }. */
export type VariantOptions = Record<string, string>;

const MAX_SKU_LENGTH = 60;
const MAX_BARCODE_LENGTH = 64;

// EPIC-047 security fix — batas ukuran matriks agar satu POST tidak bisa
// membuat ribuan baris di dalam transaksi FOR UPDATE (lihat validateMatrixSize).
export const MAX_AXES = 10;
export const MAX_VALUES_PER_AXIS = 50;
export const MAX_COMBOS = 500;

// EPIC-047 security fix (S1) — dilempar oleh expandMatrix SEBELUM alokasi
// apa pun kalau hasil kombinasi akan melebihi MAX_COMBOS. Ini adalah
// self-guard: expandMatrix tidak boleh bisa disalahgunakan pemanggil lain
// (sekarang atau di masa depan) tanpa lebih dulu lewat validateMatrixSize.
export class MatrixTooLargeError extends Error {
  constructor(message: string = `Maksimal ${MAX_COMBOS} kombinasi varian per produk`) {
    super(message);
    this.name = "MatrixTooLargeError";
  }
}

function cleanValues(values: unknown): string[] {
  // EPIC-047 security fix (S3) — `values` bisa berupa apa saja dari body
  // JSON yang tidak dipercaya (mis. angka, objek). Non-array diperlakukan
  // sebagai "tidak ada nilai" alih-alih `for...of` meledak dengan
  // TypeError yang bocor sebagai 500.
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    const dedupeKey = value.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(value);
  }
  return out;
}

type CleanAxis = { key: string; values: string[] };

function cleanAxesForMatrix(axes: VariantAxis[]): CleanAxis[] {
  return (axes ?? [])
    .map((axis) => ({ key: String(axis?.key ?? "").trim(), values: cleanValues(axis?.values ?? []) }))
    .filter((axis) => axis.key.length > 0);
}

/**
 * `true` kalau `axes` bukan array, atau salah satu entrinya bukan objek,
 * `key`-nya bukan string, atau `values`-nya bukan array — dipakai
 * validateMatrixSize untuk membedakan "bentuk input salah" (400 spesifik)
 * dari "ukuran melebihi batas" (S3).
 */
function hasMalformedAxisShape(axes: unknown): boolean {
  if (!Array.isArray(axes)) return true;
  return axes.some((axis) => {
    if (typeof axis !== "object" || axis === null) return true;
    const candidate = axis as { key?: unknown; values?: unknown };
    if (typeof candidate.key !== "string") return true;
    if (!Array.isArray(candidate.values)) return true;
    return false;
  });
}

/**
 * Cartesian product antar sumbu, urutan sumbu & nilai dipertahankan. Sumbu
 * tanpa nilai (setelah trim/dedupe) membuat hasil kosong (tidak ada baris
 * yang bisa dibentuk tanpa nilai untuk sumbu itu).
 *
 * EPIC-047 security fix (S1) — ukuran hasil dihitung SECARA ARITMETIK
 * (perkalian panjang tiap sumbu) SEBELUM baris manapun dialokasikan; kalau
 * melebihi MAX_COMBOS, lempar MatrixTooLargeError tanpa alokasi apa pun.
 * Pemanggil (route) tetap wajib panggil validateMatrixSize lebih dulu untuk
 * pesan error yang lebih spesifik (jumlah sumbu / nilai per sumbu) — guard
 * di sini murni self-defense kalau urutan itu tidak diikuti.
 */
export function expandMatrix(axes: VariantAxis[]): VariantOptions[] {
  const cleanAxes = cleanAxesForMatrix(axes);

  if (cleanAxes.length === 0) return [];
  if (cleanAxes.some((axis) => axis.values.length === 0)) return [];

  const comboCount = cleanAxes.reduce((acc, axis) => acc * axis.values.length, 1);
  if (comboCount > MAX_COMBOS) {
    throw new MatrixTooLargeError();
  }

  let combos: VariantOptions[] = [{}];
  for (const axis of cleanAxes) {
    const next: VariantOptions[] = [];
    for (const combo of combos) {
      for (const value of axis.values) {
        next.push({ ...combo, [axis.key]: value });
      }
    }
    combos = next;
  }
  return combos;
}

export type MatrixSizeResult = { ok: true } | { ok: false; error: string };

/**
 * Batas ukuran matriks (defense-in-depth) — dicek terpisah dari expandMatrix
 * supaya pesan error spesifik per pelanggaran & bisa dipakai di client
 * (preview) maupun server (route) tanpa duplikasi aturan. Ukuran dihitung
 * SECARA ARITMETIK (perkalian panjang sumbu), tidak pernah dengan
 * mengekspansi matriksnya — supaya validateMatrixSize sendiri tidak bisa
 * jadi vektor DoS.
 */
export function validateMatrixSize(axes: VariantAxis[]): MatrixSizeResult {
  // EPIC-047 security fix (S3) — bentuk input salah (axes bukan array, atau
  // ada entri sumbu yang bukan objek / key bukan string / values bukan
  // array) ditolak dengan pesan spesifik, bukan menabrak 500.
  if (!Array.isArray(axes)) {
    return { ok: false, error: "Sumbu varian harus berupa daftar" };
  }
  if (hasMalformedAxisShape(axes)) {
    return { ok: false, error: "Nilai sumbu harus berupa daftar" };
  }

  const cleanAxes = cleanAxesForMatrix(axes);

  if (cleanAxes.length > MAX_AXES) {
    return { ok: false, error: `Maksimal ${MAX_AXES} sumbu varian` };
  }
  if (cleanAxes.some((axis) => axis.values.length > MAX_VALUES_PER_AXIS)) {
    return { ok: false, error: `Maksimal ${MAX_VALUES_PER_AXIS} nilai per sumbu` };
  }
  const comboCount = cleanAxes.reduce(
    (acc, axis) => acc * axis.values.length,
    cleanAxes.length > 0 ? 1 : 0
  );
  if (comboCount > MAX_COMBOS) {
    return { ok: false, error: `Maksimal ${MAX_COMBOS} kombinasi varian per produk` };
  }
  return { ok: true };
}

function slugToken(value: string): string {
  return value
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // lepas diakritik
    .replace(/[^A-Z0-9]+/g, "");
}

/**
 * Kode SKU deterministik: BASE-VALUE1-VALUE2-... (urutan sesuai kunci
 * `options`, non-alnum dibuang, huruf besar). Dipotong ≤60 karakter dengan
 * memendekkan token nilai (bukan base) secara merata dari yang terakhir.
 */
export function buildSkuCode(baseSku: string, options: VariantOptions): string {
  // Base dipertahankan apa adanya (termasuk tanda hubungnya sendiri, mis.
  // "KAOS-001") — hanya di-trim & uppercase. Non-alnum → nothing HANYA
  // berlaku untuk token nilai yang ditambahkan (lihat slugToken di bawah).
  const base = String(baseSku ?? "").trim().toUpperCase() || "SKU";
  const tokens = Object.keys(options)
    .map((key) => slugToken(options[key]))
    .filter((token) => token.length > 0);

  let code = [base, ...tokens].join("-");
  if (code.length <= MAX_SKU_LENGTH) return code;

  // Terlalu panjang — pendekkan token nilai dari yang paling belakang dulu,
  // base TIDAK PERNAH dipotong.
  const parts = [...tokens];
  while (parts.length > 0 && [base, ...parts].join("-").length > MAX_SKU_LENGTH) {
    const lastIndex = parts.length - 1;
    const current = parts[lastIndex];
    if (current.length <= 1) {
      parts.pop();
    } else {
      parts[lastIndex] = current.slice(0, current.length - 1);
    }
  }
  code = [base, ...parts].join("-");
  // Fallback ekstrem: base sendiri sudah > 60 — potong bagian akhir base
  // hanya sebagai upaya terakhir (tidak diharapkan terjadi di praktik).
  if (code.length > MAX_SKU_LENGTH) {
    code = code.slice(0, MAX_SKU_LENGTH);
  }
  return code;
}

/**
 * EPIC-047 security fix (S2) — barcode komposit = `barcodePrefix + skuCode`
 * bisa melebihi 64 karakter (prefix ≤20 + SKU ≤60) meski masing-masing
 * lolos cap-nya sendiri. Dicek PRA-transaksi untuk semua kode SKU yang akan
 * dibuat, supaya matriks yang valid tidak gagal mendadak di tengah
 * transaksi (setelah FOR UPDATE / reactivate). Pure, tanpa I/O.
 */
export function composedBarcodeTooLong(prefix: string, skuCodes: string[]): boolean {
  if (!prefix) return false;
  return skuCodes.some((sku) => `${prefix}${sku}`.length > MAX_BARCODE_LENGTH);
}

/** Nama SKU: "Nama Produk — Value1 / Value2". */
export function buildSkuName(productName: string, options: VariantOptions): string {
  const name = String(productName ?? "").trim();
  const values = Object.keys(options)
    .map((key) => String(options[key] ?? "").trim())
    .filter((value) => value.length > 0);
  if (values.length === 0) return name;
  return `${name} — ${values.join(" / ")}`;
}

/** Bandingkan dua objek options tanpa peduli urutan kunci. */
function optionsKey(options: VariantOptions): string {
  return Object.keys(options)
    .sort()
    .map((key) => `${key.toLowerCase()}=${String(options[key] ?? "").trim().toLowerCase()}`)
    .join("&");
}

export type ExistingSku = {
  id: string;
  sku: string;
  name: string;
  options: VariantOptions | null;
  stock_quantity: number;
  is_active: boolean;
};

export type DiffMatrixResult = {
  create: VariantOptions[];
  reactivate: ExistingSku[];
  deactivate: ExistingSku[];
  keep: ExistingSku[];
};

/**
 * Bandingkan SKU yang ada (aktif MAUPUN non-aktif) dengan matriks yang
 * diinginkan, dicocokkan lewat objek `options` (order-insensitive) — identitas
 * options menang atas kode SKU. `create` = kombinasi diinginkan yang sama
 * sekali belum pernah ada; `reactivate` = baris non-aktif yang options-nya
 * diinginkan lagi (mis. warna yang sempat di-drop lalu dibawa balik musim
 * depan) — dihidupkan lagi, bukan di-insert ulang (hindari duplikat unique
 * `sku`); `keep` = baris aktif yang tetap dipakai; `deactivate` = baris aktif
 * yang tidak lagi diinginkan (tidak berubah dari sebelumnya).
 */
export function diffMatrix(existing: ExistingSku[], wanted: VariantOptions[]): DiffMatrixResult {
  const rows = existing ?? [];
  const activeExisting = rows.filter((row) => row.is_active !== false);

  // Peta SEMUA baris (aktif & non-aktif) per options key. Kalau ada lebih
  // dari satu baris untuk key yang sama (tidak diharapkan terjadi setelah
  // fix ini), baris aktif menang atas yang non-aktif.
  const allByKey = new Map<string, ExistingSku>();
  for (const row of rows) {
    const key = optionsKey(row.options ?? {});
    const current = allByKey.get(key);
    if (!current || (row.is_active !== false && current.is_active === false)) {
      allByKey.set(key, row);
    }
  }

  const wantedKeys = new Set(wanted.map((options) => optionsKey(options)));

  const create: VariantOptions[] = [];
  const keep: ExistingSku[] = [];
  const reactivate: ExistingSku[] = [];
  for (const options of wanted) {
    const key = optionsKey(options);
    const match = allByKey.get(key);
    if (!match) {
      create.push(options);
    } else if (match.is_active === false) {
      reactivate.push(match);
    } else {
      keep.push(match);
    }
  }

  const deactivate = activeExisting.filter((row) => !wantedKeys.has(optionsKey(row.options ?? {})));

  return { create, reactivate, deactivate, keep };
}

/** Aturan 409: SKU ber-stok tidak boleh hilang tanpa sengaja. */
export function blockedDeactivations(
  existing: ExistingSku[],
  deactivateIds: string[]
): ExistingSku[] {
  const ids = new Set(deactivateIds);
  return (existing ?? []).filter((row) => ids.has(row.id) && Number(row.stock_quantity) > 0);
}
