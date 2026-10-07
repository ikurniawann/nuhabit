"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CrmSettings } from "../types";
import { useCrmSettings, useCrmTiers, useCrmXpRules, usePosProductXp, useSaveCrmSettings } from "../queries";
import { CsSettingsSection } from "./cs-settings-section";
import { LoyaltyFeaturesSection } from "./loyalty-features-section";
import { ProductXpSection } from "./product-xp-section";
import { TierConfigSection } from "./tier-config-section";
import { TopupBonusSection } from "./topup-bonus-section";
import { XpRulesSection } from "./xp-rules-section";

export function CrmSettingsPage() {
  const router = useRouter();
  const settingsQuery = useCrmSettings();
  const tiersQuery = useCrmTiers();
  const rulesQuery = useCrmXpRules();
  const productsQuery = usePosProductXp();
  // Menu (sidebar/POS) dirender server — segarkan agar saklar fitur langsung terlihat.
  const saveSettingsMutation = useSaveCrmSettings(() => router.refresh());

  const loading = settingsQuery.isLoading || tiersQuery.isLoading || rulesQuery.isLoading;
  const settingsProps = {
    settings: settingsQuery.data,
    loading: settingsQuery.isLoading,
    saving: saveSettingsMutation.isPending,
    onSave: (payload: Partial<CrmSettings>) => saveSettingsMutation.mutate(payload),
  };
  // Draf form di-reset tiap kali isi pengaturan dari server berubah.
  const settingsKey = settingsQuery.data ? JSON.stringify(settingsQuery.data) : "loading";

  function refetchAll() {
    void settingsQuery.refetch();
    void tiersQuery.refetch();
    void rulesQuery.refetch();
    void productsQuery.refetch();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/dashboard/crm"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard CRM
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-foreground">Konfigurasi Loyalty</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tier, aturan XP, bonus topup, dan XP gratis — hanya Super Admin yang bisa menyimpan.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={refetchAll}
          disabled={loading}
          className="purchasing-secondary-button"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Muat ulang
        </Button>
      </div>

      <LoyaltyFeaturesSection {...settingsProps} />
      <TopupBonusSection key={`topup-${settingsKey}`} {...settingsProps} />
      <CsSettingsSection key={`cs-${settingsKey}`} {...settingsProps} />
      <TierConfigSection tiers={tiersQuery.data ?? []} loading={tiersQuery.isLoading} />
      <XpRulesSection rules={rulesQuery.data ?? []} loading={rulesQuery.isLoading} />
      <ProductXpSection products={productsQuery.data ?? []} loading={productsQuery.isLoading} />
    </div>
  );
}
