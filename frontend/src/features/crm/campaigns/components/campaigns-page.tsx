"use client";

// EPIC-033 — halaman Kampanye WA: daftar kampanye + buat (segmen →
// preview → template → promo) + laporan funnel + konfigurasi pengirim
// (master switch, default MATI) + daftar opt-out. Pengiriman riil
// sepenuhnya di watcher — halaman ini tidak pernah mengirim langsung.

import { useState } from "react";
import { CampaignSenderConfig } from "./campaign-sender-config";
import { CampaignTable } from "./campaign-table";
import { CampaignOptouts } from "./campaign-optouts";
import { CreateCampaignDialog } from "./create-campaign-dialog";
import { CampaignReportDialog } from "./campaign-report-dialog";

export function CampaignsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Kampanye</h1>
        <p className="mt-1 text-sm text-gray-500">
          Win-back & promo tersegmentasi ke member lewat WhatsApp, notifikasi in-app, atau keduanya. WA berjalan pelan
          (anti-ban), menghormati jam 8–21 WIB, plafon harian, dan opt-out; in-app langsung masuk kotak masuk portal.
        </p>
      </div>

      <CampaignSenderConfig />
      <CampaignTable onCreate={() => setCreateOpen(true)} onReport={setReportId} />
      <CampaignOptouts />
      <CreateCampaignDialog open={createOpen} onOpenChange={setCreateOpen} />
      <CampaignReportDialog reportId={reportId} onClose={() => setReportId(null)} />
    </div>
  );
}
