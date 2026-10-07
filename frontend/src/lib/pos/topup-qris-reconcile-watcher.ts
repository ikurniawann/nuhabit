import { createPgClient } from "@/lib/pg/create-client";
import { reconcileAllPendingTopups } from "@/lib/pos/topup-qris-reconcile";

/**
 * Pengawas berkala topup QRIS pending (insiden owner 2026-09-04): bila
 * webhook Xendit tidak sampai DAN kasir menutup halaman, pembayaran yang
 * sudah berhasil tetap dikredit otomatis dalam ≤ 2 menit.
 * Sekali per proses server (pola watcher lain di instrumentation.ts).
 */
const CHECK_INTERVAL_MS = 2 * 60_000;
let started = false;

export function startQrisTopupReconciler(): void {
  if (started) return;
  started = true;
  const tick = () => {
    reconcileAllPendingTopups(createPgClient())
      .then((r) => {
        if (r.checked > 0) {
          console.info(`[topup-reconcile] dicek ${r.checked} pending, dikredit ${r.credited}, error ${r.errors}`);
        }
      })
      .catch((error) => {
        console.error("[topup-reconcile] sapuan gagal:", error);
      });
  };
  setTimeout(tick, 30_000);
  setInterval(tick, CHECK_INTERVAL_MS);
}
