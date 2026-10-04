/**
 * EPIC-024 — Customer Facing Display (CFD) POS.
 *
 * Kasir MEM-PUBLISH state transaksi; layar customer (window kedua di
 * monitor kedua PC kasir) SUBSCRIBE — satu arah, read-only. Transport:
 * BroadcastChannel antar-tab satu browser (latensi ~0, tanpa server,
 * jalan offline) + snapshot localStorage supaya refresh display tidak
 * kosong. Kontrak state dibuat mandiri agar jembatan SSE (perangkat
 * terpisah) bisa menyusul membawa payload yang SAMA tanpa rombak.
 */

export const CFD_CHANNEL = "pos-cfd";
export const CFD_SNAPSHOT_KEY = "pos-cfd-snapshot";
/** Layar "Terima kasih" ditahan sekian ms sebelum menerima idle. */
export const CFD_DONE_HOLD_MS = 6000;

export interface CfdItem {
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

export interface CfdPayment {
  // Kode bawaan ATAU metode kustom buatan admin (master Metode Bayar)
  method: "cash" | "qris" | "credit_card" | "ark_coin" | "nfc_tab" | "gift_card" | (string & {});
  /** Nominal yang harus dibayar (setelah ARK Coin). */
  amount: number;
  cash_received?: number;
  change?: number;
  /** Payload QRIS dinamis Xendit — dirender jadi QR besar di display. */
  qr_string?: string | null;
  /** QR sedang dibuat — display menampilkan spinner, bukan QR basi. */
  qr_loading?: boolean;
}

export interface CfdState {
  status: "idle" | "cart" | "payment" | "done";
  items: CfdItem[];
  subtotal: number;
  /** Diskon membership (Rp). */
  discount: number;
  tax: number;
  /** ARK Coin member yang dipakai (Rp). */
  ark_used: number;
  total: number;
  payment?: CfdPayment | null;
  /** Nama depan member — jangan kirim nomor telepon ke layar publik. */
  member_name?: string | null;
  /** Kembalian utk layar done. */
  done_change?: number;
  updated_at: number;
}

export function idleCfdState(now = Date.now()): CfdState {
  return {
    status: "idle",
    items: [],
    subtotal: 0,
    discount: 0,
    tax: 0,
    ark_used: 0,
    total: 0,
    payment: null,
    member_name: null,
    updated_at: now,
  };
}

/** Nama depan saja — layar menghadap publik, jaga privasi member. */
export function firstNameOnly(fullName: string | null | undefined): string | null {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}

/** Validasi longgar snapshot dari localStorage — data korup jangan meledak. */
export function parseCfdSnapshot(raw: string | null): CfdState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CfdState;
    if (!parsed || typeof parsed !== "object") return null;
    if (!["idle", "cart", "payment", "done"].includes(parsed.status)) return null;
    if (!Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

type CfdListener = (state: CfdState) => void;

/**
 * Publish state ke display. BroadcastChannel bila ada; localStorage selalu
 * ditulis (snapshot utk refresh + fallback event 'storage' antar-tab bila
 * BroadcastChannel tak tersedia).
 */
export function publishCfdState(state: CfdState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CFD_SNAPSHOT_KEY, JSON.stringify(state));
  } catch {
    // storage penuh/di-block — BroadcastChannel tetap jalan
  }
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CFD_CHANNEL);
    channel.postMessage(state);
    channel.close();
  }
}

/** Subscribe state dari kasir; kembalikan fungsi unsubscribe. */
export function subscribeCfdState(listener: CfdListener): () => void {
  if (typeof window === "undefined") return () => {};

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CFD_CHANNEL);
    channel.onmessage = (event) => listener(event.data as CfdState);
  }
  // Fallback + sinkron lintas-browser-context yang tidak share channel
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CFD_SNAPSHOT_KEY) return;
    const state = parseCfdSnapshot(event.newValue);
    if (state) listener(state);
  };
  window.addEventListener("storage", onStorage);

  // Hydrate awal dari snapshot — display baru dibuka langsung nyambung
  const snapshot = parseCfdSnapshot(
    window.localStorage.getItem(CFD_SNAPSHOT_KEY)
  );
  if (snapshot) listener(snapshot);

  return () => {
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
}
