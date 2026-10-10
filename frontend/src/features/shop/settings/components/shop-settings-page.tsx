'use client';

// Settings → Storefront (IAM shop.settings): the storefront card. Courier
// settings stay on Settings → Pengiriman.

import Link from 'next/link';
import { PurchasingPageHeader } from '@/features/purchasing/components/shared/purchasing-page-header';
import { StorefrontSettingsSection } from './storefront-settings-section';

export function ShopSettingsPage() {
  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Storefront Settings"
        description="Ambil di cabang, gratis ongkir, badge stok menipis dan nomor WhatsApp toko online."
      />
      <StorefrontSettingsSection />
      <p className="text-xs text-gray-500">
        Provider ongkir, origin dan kurir aktif diatur di{' '}
        <Link href="/dashboard/settings/shipping" className="font-semibold text-forest underline">Pengiriman (Kurir)</Link>.
      </p>
    </div>
  );
}
