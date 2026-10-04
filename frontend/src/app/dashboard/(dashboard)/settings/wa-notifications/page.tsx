import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { WaNotifSettingsPanel } from "@/features/os-desktop/components/settings/wa-notif-settings";
import { OrderAlertSettingsCard } from "@/features/configuration/order-alerts/order-alert-settings-card";

/**
 * Settings → Notifikasi WA di dashboard.
 *
 * Komponennya sama dengan jendela Settings di desktop /os (EPIC-020) —
 * satu sumber untuk recipients owner, ambang notifikasi, dan penerima laporan
 * tutup kasir. Komponen itu ditata untuk latar gelap desktop, jadi di dashboard
 * (terang) ia dirender dengan tone="light" — satu form dua kulit, bukan dua salinan.
 */
export default async function WaNotificationsSettingsPage() {
  await requireIamPage(IAM.settingsIntegrations);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold text-gray-900">Notifikasi WA</h1>
      <p className="mt-1 text-sm text-gray-500">
        Nomor penerima notifikasi owner, ambang peringatan, dan penerima laporan
        tutup kasir.
      </p>
      <div className="mt-4">
        <WaNotifSettingsPanel tone="light" />
      </div>
      <OrderAlertSettingsCard />
    </div>
  );
}
