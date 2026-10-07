"use client";

import { BandsSection } from "./bands-section";
import { CapacitySection } from "./capacity-section";
import { GeneralSettingsSection } from "./general-settings-section";
import { StaffPassesSection } from "./staff-passes-section";
import { TimeSlotsSection } from "./time-slots-section";

// Revisi Manage Ticket (2026-07-21): kalender musim & harga pindah ke
// masing-masing ticket di Master Ticket — halaman ini menyusut jadi
// kebijakan venue + registry gelang.
export function TicketingSettingsPage() {
  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Pengaturan Tiket</h1>
        <p className="mt-1 text-sm text-gray-500">
          Kebijakan venue (plafon postpaid, mode bayar default, default
          re-entry ticket baru) dan registry gelang NFC. Produk tiket, harga,
          dan kalender dikelola di Master Ticket.
        </p>
      </div>

      <GeneralSettingsSection />
      <CapacitySection />
      <TimeSlotsSection />
      <BandsSection />
      <StaffPassesSection />
    </div>
  );
}
