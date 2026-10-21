/**
 * EPIC-058 — pengawas job studio (pola watcher lain di instrumentation.ts).
 * Tiap 10 menit per venue: tutup hari bila sudah lewat jam tutup dan belum
 * jalan hari ini (server mati di jam itu → dikejar tick berikutnya), lalu
 * pengingat WhatsApp (bila dinyalakan, hanya 08.00–21.00 WIB), kabar perubahan
 * jadwal yang tertahan, dan eskalasi tiket keluhan (EPIC-067).
 * STUDIO_JOBS_DISABLED=1 mematikan watcher di proses ini.
 */

import { dailyCloseDue } from "./jobs";
import { lastAutoRunDate, loadJobSettings, runDailyClose, runReminders, studioVenues } from "./jobs-server";
import { flushChangeNotices } from "./session-change-server";
import { escalateOverdueComplaints } from "./complaints-server";

const CHECK_INTERVAL_MS = 10 * 60_000;
let started = false;
let running = false;

export async function studioJobsTick(now: Date = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const v of await studioVenues()) {
      const s = await loadJobSettings(v.branchId);
      if (dailyCloseDue(s, now, await lastAutoRunDate(v.branchId, "daily_close"))) {
        const res = await runDailyClose(v, "auto");
        if (res.ran) console.log("[studio-jobs] tutup hari:", JSON.stringify(res.summary), res.error ?? "");
      }
      if (s.reminders_enabled) await runReminders(v, { now, trigger: "auto" });
    }
    // Kabar perubahan jadwal yang ditahan jam tenang (EPIC-067 T-067-A6) — tidak ikut saklar pengingat.
    const changes = await flushChangeNotices(now);
    if (changes.sent || changes.failed) console.log("[studio-jobs] kabar perubahan jadwal:", JSON.stringify(changes));
    // Eskalasi tiket keluhan yang lewat batas waktu (EPIC-067 T-067-B3).
    const esc = await escalateOverdueComplaints(now);
    if (esc.escalated) console.log("[studio-jobs] eskalasi keluhan:", JSON.stringify(esc));
  } finally {
    running = false;
  }
}

export function startStudioJobsWatcher(): void {
  if (started || process.env.STUDIO_JOBS_DISABLED === "1") return;
  started = true;
  const tick = () => {
    studioJobsTick().catch((error) => console.error("[studio-jobs] tick gagal:", error));
  };
  setTimeout(tick, 90_000);
  setInterval(tick, CHECK_INTERVAL_MS);
}
