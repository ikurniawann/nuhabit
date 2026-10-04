/**
 * EPIC-050 Fase 2 — watcher workflow: aksi terjadwal (setelah `wait`) dan
 * trigger berbasis waktu (inactive_days, due_soon). Tiap 5 menit.
 */
import { runDueScheduledActions, scanTimeBasedRules } from "./workflow-engine";

const CHECK_INTERVAL_MS = 5 * 60_000;
let started = false;

export async function workflowTick(): Promise<{ scheduled: number; timeBased: number }> {
  const scheduled = await runDueScheduledActions();
  const timeBased = await scanTimeBasedRules();
  if (scheduled > 0 || timeBased > 0) {
    console.log(`[crm-workflow] ${scheduled} aksi terjadwal, ${timeBased} trigger waktu dijalankan`);
  }
  return { scheduled, timeBased };
}

/** Daftarkan pengecekan berkala — sekali per proses server (pola cs-sla-watcher). */
export function startCrmWorkflowWatcher(): void {
  if (started) return;
  started = true;
  const tick = () => {
    workflowTick().catch((error) => console.error("[crm-workflow] watcher gagal:", error));
  };
  setTimeout(tick, 45_000);
  setInterval(tick, CHECK_INTERVAL_MS);
}
