import { runWalletSweep } from "./sweep";

/**
 * Pengawas dompet tiap jam: kedaluwarsa saldo, pengingat, dorongan saldo
 * rendah. Sekali per proses server (pola watcher lain di instrumentation.ts);
 * advisory lock di runWalletSweep mencegah dua proses menyapu bersamaan.
 */
const CHECK_INTERVAL_MS = 60 * 60_000;
let started = false;

export function startWalletSweepWatcher(): void {
  if (started) return;
  started = true;
  const tick = () => {
    runWalletSweep({ trigger: "auto" })
      .then((r) => {
        if (r.expired_lots || r.reminders_sent || r.nudges_sent) {
          console.info(
            `[wallet-sweep] hangus ${r.expired_lots} lot (Rp ${r.expired_idr}), pengingat ${r.reminders_sent}, saldo rendah ${r.nudges_sent}`
          );
        }
      })
      .catch((error) => console.error("[wallet-sweep] sapuan gagal:", error));
  };
  setTimeout(tick, 90_000);
  setInterval(tick, CHECK_INTERVAL_MS);
}
