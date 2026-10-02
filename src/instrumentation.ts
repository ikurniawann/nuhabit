/**
 * Next.js instrumentation — berjalan sekali saat server boot.
 * Dipakai utk job internal ringan (auto-snapshot KPI bulanan, pengawas SLA CS).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startKpiAutoSnapshot } = await import("@/lib/kpi/auto-snapshot");
    startKpiAutoSnapshot();

    const { startCsSlaWatcher } = await import("@/lib/crm/cs-sla-watcher");
    startCsSlaWatcher();

    const { startGoogleReviewSync } = await import("@/lib/crm/google-reviews-sync-job");
    startGoogleReviewSync();

    const { startSalesFollowupWatcher } = await import(
      "@/lib/sales-funnel/followup-reminder-watcher"
    );
    startSalesFollowupWatcher();

    const { startWaNotifWatcher } = await import("@/lib/wa/notifications-watcher");
    startWaNotifWatcher();

    // Insiden 2026-09-04: topup QRIS yang webhook-nya tidak sampai tetap
    // dikredit otomatis (rekonsiliasi ke Xendit tiap 2 menit).
    const { startQrisTopupReconciler } = await import("@/lib/pos/topup-qris-reconcile-watcher");
    startQrisTopupReconciler();

    const { startBookingForfeitWatcher } = await import(
      "@/lib/ticketing/booking-forfeit-watcher"
    );
    startBookingForfeitWatcher();

    // EPIC-033 — pengirim kampanye WA (master switch default MATI di
    // crm_campaign_config; aman terdaftar walau belum dipakai)
    const { startCampaignWatcher } = await import("@/lib/crm/campaign-watcher");
    startCampaignWatcher();
    // EPIC-050 Fase 2 — workflow automation: aksi terjadwal + trigger waktu
    const { startCrmWorkflowWatcher } = await import("@/lib/crm/workflow-watcher");
    startCrmWorkflowWatcher();
    // EPIC-050 Fase 3 — pengingat quotation mendekati kedaluwarsa
    const { startQuotationExpiryWatcher } = await import("@/lib/sales-funnel/quotation-expiry-watcher");
    startQuotationExpiryWatcher();
    // EPIC-050 Fase 4 — pengirim report terjadwal (WA / notifikasi aplikasi)
    const { startReportScheduleWatcher } = await import("@/lib/crm/report-schedule-watcher");
    startReportScheduleWatcher();
    // EPIC-058 — NüHabit: tutup hari studio (sesi lewat, pass kedaluwarsa) + pengingat WA member
    const { startStudioJobsWatcher } = await import("@/lib/studio/jobs-watcher");
    startStudioJobsWatcher();
  }
}
