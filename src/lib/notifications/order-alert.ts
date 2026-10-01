/**
 * Notifikasi "pesanan masuk" ke staf (WA karyawan ber-role POS + Telegram) —
 * bagian murni: konfigurasi & isi pesan. Pengiriman di order-alert-server.ts.
 */

export const ORDER_ALERT_SETTING_KEY = "order_alert_config";
export const ORDER_ALERT_ROLE_OPTIONS = [
  { code: "pos", label: "POS (kasir/barista)" },
  { code: "pos_supervisor", label: "POS Supervisor" },
] as const;

export type OrderAlertConfig = {
  /** Kirim WA ke karyawan dengan role di `waRoles`. */
  waEnabled: boolean;
  waRoles: string[];
  /** Kirim ke semua chat Telegram yang /start bot. */
  telegramEnabled: boolean;
};

export const DEFAULT_ORDER_ALERT_CONFIG: OrderAlertConfig = {
  waEnabled: true,
  waRoles: ["pos"],
  telegramEnabled: true,
};

export function parseOrderAlertConfig(raw: string | null | undefined): OrderAlertConfig {
  if (!raw) return { ...DEFAULT_ORDER_ALERT_CONFIG };
  try {
    const value = JSON.parse(raw) as Partial<OrderAlertConfig>;
    const allowed = new Set<string>(ORDER_ALERT_ROLE_OPTIONS.map((role) => role.code));
    const roles = Array.isArray(value.waRoles) ? value.waRoles.filter((role) => allowed.has(String(role))) : null;
    return {
      waEnabled: typeof value.waEnabled === "boolean" ? value.waEnabled : DEFAULT_ORDER_ALERT_CONFIG.waEnabled,
      waRoles: roles ?? [...DEFAULT_ORDER_ALERT_CONFIG.waRoles],
      telegramEnabled:
        typeof value.telegramEnabled === "boolean" ? value.telegramEnabled : DEFAULT_ORDER_ALERT_CONFIG.telegramEnabled,
    };
  } catch {
    return { ...DEFAULT_ORDER_ALERT_CONFIG };
  }
}

export type OrderAlertInput = {
  brandName: string;
  sourceLabel: string;
  tableLabel: string | null;
  orderType: "dine_in" | "takeaway" | string;
  queueNumber: string | null;
  orderNumber: string;
  paymentLabel: string;
  paid: boolean;
  guestName?: string | null;
  /** 628xx — ditampilkan lokal (08xx) supaya staf bisa langsung menghubungi. */
  guestPhone?: string | null;
  isMember?: boolean;
  customerNote?: string | null;
  total: number;
  items: Array<{ name: string; quantity: number; variant?: string | null; modifiers?: string[] }>;
  /** Link layar "Buatkan Pesanan" (/dashboard/pos/self-orders?order=…). */
  actionUrl?: string | null;
};

const localPhone = (phone: string) => (phone.startsWith("62") ? `0${phone.slice(2)}` : phone);

const rupiah = (value: number) => `Rp${Math.round(value).toLocaleString("id-ID")}`;

/** Teks polos (tanpa markdown) — dipakai sama untuk WA & Telegram. */
export function buildOrderAlertMessage(input: OrderAlertInput): string {
  const place = [
    input.tableLabel ? `Meja ${input.tableLabel}` : null,
    input.orderType === "takeaway" ? "Bawa pulang" : "Makan di tempat",
  ]
    .filter(Boolean)
    .join(" · ");
  const lines = [
    `🛎️ Pesanan baru — ${input.sourceLabel}`,
    input.brandName,
    place,
    `Antrean ${input.queueNumber || "-"} · ${input.orderNumber}`,
    input.guestName
      ? `Atas nama: ${input.guestName}${input.isMember ? " (member)" : ""}${input.guestPhone ? ` · WA ${localPhone(input.guestPhone)}` : ""}`
      : null,
    "",
    ...input.items.map((item) => {
      const extras = [item.variant, ...(item.modifiers ?? [])].filter(Boolean).join(", ");
      return `• ${item.quantity}× ${item.name}${extras ? ` (${extras})` : ""}`;
    }),
    input.customerNote ? `\nCatatan: ${input.customerNote}` : null,
    "",
    `Total ${rupiah(input.total)} · ${input.paymentLabel}${input.paid ? " (lunas)" : " (belum dibayar)"}`,
    // WA tidak mendukung tautan berjudul → judul ditulis di depan URL.
    input.actionUrl ? `\n👉 Buatkan Pesanan: ${input.actionUrl}` : null,
  ];
  return lines.filter((line) => line !== null).join("\n").trim();
}
