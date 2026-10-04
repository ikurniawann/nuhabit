/**
 * Nomor antrian reservasi / waiting list (owner 2026-08-16).
 *
 * Setiap reservasi (termasuk walk-in menunggu meja, tanpa order) mendapat
 * nomor urut per tanggal — ditampilkan di halaman Reservation, dicetak slip
 * thermal, dan dikirim via WA. Prefiks "W" (waiting) membedakannya dari
 * antrian pesanan dapur ("ANTRIAN A-xx" di struk).
 */

export function formatReservationQueueNumber(
  value: number | null | undefined
): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `W-${String(Math.floor(n)).padStart(2, "0")}`;
}

export function buildReservationQueueWaMessage(input: {
  guestName: string;
  queueLabel: string;
  dateLabel: string;
  timeLabel: string;
  paxCount: number;
  tableLabel?: string | null;
  merchantName?: string | null;
}): string {
  const lines = [
    `Halo ${input.guestName}!`,
    "",
    `Nomor antrian Anda: *${input.queueLabel}*`,
    "",
    `Tanggal: ${input.dateLabel}`,
    `Jam: ${input.timeLabel}`,
    `Jumlah tamu: ${input.paxCount} orang`,
  ];
  if (input.tableLabel) lines.push(`Meja: ${input.tableLabel}`);
  lines.push(
    "",
    "Mohon tunjukkan nomor ini saat dipanggil. Kami akan menghubungi Anda begitu meja siap.",
    "",
    `Terima kasih 🙏`,
    input.merchantName || ""
  );
  return lines.join("\n").trimEnd();
}
