"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Coins,
  Crown,
  Gift,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sparkles,
} from "lucide-react";
import type { CrmTierConfig, CrmXpRuleConfig } from "../types";
import {
  getCrmSettings,
  listCrmTiers,
  listCrmXpRules,
  listPosProductXp,
  saveCrmTier,
  saveCrmXpRule,
  updateCrmSettings,
  updateProductXp,
} from "../api";
import { CsSettingsSection } from "./cs-settings-section";
import { LoyaltyFeaturesSection } from "./loyalty-features-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const numberFormat = new Intl.NumberFormat("id-ID");
const currencyFormat = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

function formatNumber(value: number) {
  return numberFormat.format(value || 0);
}

function formatCurrency(value: number) {
  return currencyFormat.format(value || 0);
}

const XP_MODE_LABELS: Record<CrmXpRuleConfig["xp_mode"], string> = {
  fixed: "Tetap",
  per_item: "Per item",
  per_amount: "Per nominal",
  multiplier: "Pengali",
  percentage: "Persentase",
};

const inputClass =
  "h-10 border-gray-200/80 bg-white focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary/30";

type TierForm = {
  code: string;
  name: string;
  rank: number;
  min_lifetime_xp: string;
  discount_percent: string;
  xp_multiplier: string;
  is_active: boolean;
};

type RuleForm = {
  code: string;
  name: string;
  source_type: string;
  xp_mode: CrmXpRuleConfig["xp_mode"];
  xp_value: string;
  amount_step: string;
  min_amount: string;
  max_xp_per_event: string;
  tier_multiplier_enabled: boolean;
  priority: string;
  is_active: boolean;
};

const emptyRuleForm: RuleForm = {
  code: "",
  name: "",
  source_type: "order_amount",
  xp_mode: "per_amount",
  xp_value: "1",
  amount_step: "1000",
  min_amount: "0",
  max_xp_per_event: "",
  tier_multiplier_enabled: true,
  priority: "100",
  is_active: true,
};

export function CrmSettingsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const settingsQuery = useQuery({ queryKey: ["crm", "settings"], queryFn: getCrmSettings });
  const tiersQuery = useQuery({ queryKey: ["crm", "settings", "tiers"], queryFn: listCrmTiers });
  const rulesQuery = useQuery({ queryKey: ["crm", "settings", "xp-rules"], queryFn: listCrmXpRules });
  const productsQuery = useQuery({ queryKey: ["crm", "settings", "product-xp"], queryFn: listPosProductXp });

  const [bonusPercent, setBonusPercent] = useState("");
  const [freeXp, setFreeXp] = useState("");
  const [tierForm, setTierForm] = useState<TierForm | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm | null>(null);
  const [ruleFormIsNew, setRuleFormIsNew] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [productXpDraft, setProductXpDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settingsQuery.data) {
      setBonusPercent(String(settingsQuery.data.topup_bonus_percent));
      setFreeXp(String(settingsQuery.data.profile_completion_free_xp));
    }
  }, [settingsQuery.data]);

  const saveSettingsMutation = useMutation({
    mutationFn: updateCrmSettings,
    onSuccess: () => {
      toast.success("Konfigurasi loyalty berhasil disimpan");
      queryClient.invalidateQueries({ queryKey: ["crm", "settings"] });
      // Menu (sidebar/POS) dirender server — segarkan agar saklar fitur langsung terlihat.
      router.refresh();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan konfigurasi");
    },
  });

  const saveTierMutation = useMutation({
    mutationFn: saveCrmTier,
    onSuccess: () => {
      toast.success("Tier berhasil disimpan");
      setTierForm(null);
      queryClient.invalidateQueries({ queryKey: ["crm", "settings", "tiers"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan tier");
    },
  });

  const saveRuleMutation = useMutation({
    mutationFn: saveCrmXpRule,
    onSuccess: () => {
      toast.success("Aturan XP berhasil disimpan");
      setRuleForm(null);
      queryClient.invalidateQueries({ queryKey: ["crm", "settings", "xp-rules"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan aturan XP");
    },
  });

  const saveProductXpMutation = useMutation({
    mutationFn: ({ productId, xp }: { productId: string; xp: number }) => updateProductXp(productId, xp),
    onSuccess: (_data, variables) => {
      toast.success("XP produk berhasil disimpan");
      setProductXpDraft((current) => {
        const next = { ...current };
        delete next[variables.productId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["crm", "settings", "product-xp"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan XP produk");
    },
  });

  const tiers = tiersQuery.data ?? [];
  const rules = rulesQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const loading = settingsQuery.isLoading || tiersQuery.isLoading || rulesQuery.isLoading;

  const filteredProducts = products.filter((product) => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return true;
    return (
      product.name.toLowerCase().includes(term) ||
      product.sku.toLowerCase().includes(term) ||
      (product.category?.name ?? "").toLowerCase().includes(term)
    );
  });
  const visibleProducts = filteredProducts.slice(0, 30);

  function refetchAll() {
    void settingsQuery.refetch();
    void tiersQuery.refetch();
    void rulesQuery.refetch();
    void productsQuery.refetch();
  }

  function editTier(tier: CrmTierConfig) {
    setTierForm({
      code: tier.code,
      name: tier.name,
      rank: Number(tier.rank) || 0,
      min_lifetime_xp: String(Number(tier.min_lifetime_xp) || 0),
      discount_percent: String(Number(tier.discount_percent) || 0),
      xp_multiplier: String(Number(tier.xp_multiplier) || 1),
      is_active: tier.is_active !== false,
    });
  }

  function submitTier() {
    if (!tierForm || saveTierMutation.isPending) return;
    const existing = tiers.find((tier) => tier.code === tierForm.code);
    saveTierMutation.mutate({
      code: tierForm.code,
      name: tierForm.name.trim(),
      rank: tierForm.rank,
      min_lifetime_xp: Number(tierForm.min_lifetime_xp) || 0,
      min_total_spend: Number(existing?.min_total_spend) || 0,
      xp_multiplier: Number(tierForm.xp_multiplier) || 1,
      discount_percent: Number(tierForm.discount_percent) || 0,
      display_color: existing?.display_color,
      is_active: tierForm.is_active,
    });
  }

  function editRule(rule: CrmXpRuleConfig) {
    setRuleFormIsNew(false);
    setRuleForm({
      code: rule.code,
      name: rule.name,
      source_type: rule.source_type,
      xp_mode: rule.xp_mode,
      xp_value: String(Number(rule.xp_value) || 0),
      amount_step: String(Number(rule.amount_step) || 1),
      min_amount: String(Number(rule.min_amount) || 0),
      max_xp_per_event: rule.max_xp_per_event == null ? "" : String(rule.max_xp_per_event),
      tier_multiplier_enabled: rule.tier_multiplier_enabled !== false,
      priority: String(Number(rule.priority) || 100),
      is_active: rule.is_active !== false,
    });
  }

  function submitRule() {
    if (!ruleForm || saveRuleMutation.isPending) return;
    if (!ruleForm.code.trim() || !ruleForm.name.trim()) {
      toast.error("Kode dan nama aturan XP wajib diisi");
      return;
    }
    saveRuleMutation.mutate({
      code: ruleForm.code.trim().toLowerCase(),
      name: ruleForm.name.trim(),
      source_channel: "pos",
      source_type: ruleForm.source_type,
      xp_mode: ruleForm.xp_mode,
      xp_value: Number(ruleForm.xp_value) || 0,
      amount_step: Number(ruleForm.amount_step) || 1,
      min_amount: Number(ruleForm.min_amount) || 0,
      max_xp_per_event: ruleForm.max_xp_per_event === "" ? null : Number(ruleForm.max_xp_per_event) || 0,
      tier_multiplier_enabled: ruleForm.tier_multiplier_enabled,
      priority: Number(ruleForm.priority) || 100,
      is_active: ruleForm.is_active,
    });
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

      <LoyaltyFeaturesSection
        settings={settingsQuery.data}
        loading={settingsQuery.isLoading}
        saving={saveSettingsMutation.isPending}
        onSave={(payload) => saveSettingsMutation.mutate(payload)}
      />

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="border-b border-gray-200/70 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4 text-primary" />
            Bonus Topup & XP Gratis
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="bonus-topup" className="text-xs text-muted-foreground">
              <Coins className="h-3.5 w-3.5" />
              Bonus topup ARK Coin (%)
            </Label>
            <Input
              id="bonus-topup"
              type="number"
              min={0}
              max={100}
              value={bonusPercent}
              onChange={(event) => setBonusPercent(event.target.value)}
              disabled={settingsQuery.isLoading || saveSettingsMutation.isPending}
              className={inputClass}
            />
            <p className="text-xs text-muted-foreground">
              Contoh: 10% → topup 1 jt mendapat saldo 1,1 jt (bonus dicatat terpisah).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="free-xp" className="text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              XP gratis jika profil 100% lengkap
            </Label>
            <Input
              id="free-xp"
              type="number"
              min={0}
              value={freeXp}
              onChange={(event) => setFreeXp(event.target.value)}
              disabled={settingsQuery.isLoading || saveSettingsMutation.isPending}
              className={inputClass}
            />
            <p className="text-xs text-muted-foreground">
              Sekali seumur hidup per member, berlaku semua tipe member.
            </p>
          </div>
          <Button
            type="button"
            onClick={() =>
              saveSettingsMutation.mutate({
                topup_bonus_percent: Math.min(100, Math.max(0, Number(bonusPercent) || 0)),
                profile_completion_free_xp: Math.max(0, Math.floor(Number(freeXp) || 0)),
              })
            }
            disabled={saveSettingsMutation.isPending || settingsQuery.isLoading}
            className="purchasing-main-button"
          >
            {saveSettingsMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saveSettingsMutation.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </CardContent>
      </Card>

      <CsSettingsSection
        settings={settingsQuery.data}
        loading={settingsQuery.isLoading}
        saving={saveSettingsMutation.isPending}
        onSave={(payload) => saveSettingsMutation.mutate(payload)}
      />

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200/70 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Crown className="h-4 w-4 text-primary" />
            Tier Membership
          </CardTitle>
          <p className="text-xs text-muted-foreground">Ditentukan dari lifetime XP (ambang min XP).</p>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Tier</th>
                <th className="px-4 py-3 text-right font-semibold">Min Lifetime XP</th>
                <th className="px-4 py-3 text-right font-semibold">Diskon (%)</th>
                <th className="px-4 py-3 text-right font-semibold">Pengali XP</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tiersQuery.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Memuat tier...
                  </td>
                </tr>
              ) : tiers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Belum ada tier.
                  </td>
                </tr>
              ) : (
                tiers.map((tier) => (
                  <tr key={tier.code} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{tier.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        urutan {tier.rank} · {tier.code}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {formatNumber(Number(tier.min_lifetime_xp) || 0)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-700">
                      {Number(tier.discount_percent) || 0}%
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {Number(tier.xp_multiplier) || 1}x
                    </td>
                    <td className="px-4 py-3">
                      {tier.is_active !== false ? (
                        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Aktif</Badge>
                      ) : (
                        <Badge variant="secondary">Nonaktif</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => editTier(tier)}
                        className="cursor-pointer"
                      >
                        <Pencil className="h-4 w-4" />
                        Ubah
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200/70 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gift className="h-4 w-4 text-primary" />
            Aturan XP (POS)
          </CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setRuleFormIsNew(true);
              setRuleForm(emptyRuleForm);
            }}
            className="purchasing-secondary-button h-9"
          >
            <Plus className="h-3.5 w-3.5" />
            Aturan baru
          </Button>
        </CardHeader>
        <p className="px-4 pt-3 text-xs text-muted-foreground">
          XP hanya diberikan untuk pembayaran penuh dengan ARK Coin. Aturan menentukan besaran XP
          per transaksi/produk.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Aturan</th>
                <th className="px-4 py-3 text-left font-semibold">Sumber</th>
                <th className="px-4 py-3 text-left font-semibold">Mode</th>
                <th className="px-4 py-3 text-right font-semibold">Nilai XP</th>
                <th className="px-4 py-3 text-right font-semibold">Per Nominal</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rulesQuery.isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Memuat aturan XP...
                  </td>
                </tr>
              ) : rules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Belum ada aturan XP — tanpa aturan, transaksi ARK Coin tidak menghasilkan XP.
                  </td>
                </tr>
              ) : (
                rules.map((rule) => (
                  <tr key={rule.code} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{rule.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {rule.code} · prio {rule.priority}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {rule.source_type === "product" ? "Produk" : "Nominal order"}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {XP_MODE_LABELS[rule.xp_mode] ?? rule.xp_mode}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-700">
                      {formatNumber(Number(rule.xp_value) || 0)}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {rule.xp_mode === "per_amount"
                        ? `Rp ${formatNumber(Number(rule.amount_step) || 1)}`
                        : "-"}
                    </td>
                    <td className="px-4 py-3">
                      {rule.is_active !== false ? (
                        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Aktif</Badge>
                      ) : (
                        <Badge variant="secondary">Nonaktif</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => editRule(rule)}
                        className="cursor-pointer"
                      >
                        <Pencil className="h-4 w-4" />
                        Ubah
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="flex flex-col gap-3 border-b border-gray-200/70 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4 text-primary" />
            XP Produk
          </CardTitle>
          <label className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Cari nama / SKU / kategori..."
              className="h-10 bg-white pl-10 text-sm focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary/30"
            />
          </label>
        </CardHeader>
        <p className="px-4 pt-3 text-xs text-muted-foreground">
          XP tambahan per produk (di luar aturan nominal transaksi). Hanya keluar bila pembayaran
          penuh ARK Coin.
        </p>

        {productsQuery.isLoading ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">Memuat produk...</div>
        ) : visibleProducts.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {productSearch.trim() ? "Tidak ada produk yang cocok." : "Belum ada produk POS."}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {visibleProducts.map((product) => {
              const draftValue = productXpDraft[product.id] ?? String(product.xp);
              const isDirty = (Number(draftValue) || 0) !== product.xp;
              const isSaving =
                saveProductXpMutation.isPending &&
                saveProductXpMutation.variables?.productId === product.id;
              return (
                <div
                  key={product.id}
                  className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_120px_110px] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{product.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{product.sku}</span>
                      <span>{product.category?.name || "Tanpa kategori"}</span>
                      <span>{formatCurrency(product.base_price)}</span>
                    </div>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    value={draftValue}
                    onChange={(event) =>
                      setProductXpDraft((current) => ({ ...current, [product.id]: event.target.value }))
                    }
                    className={`h-9 ${inputClass}`}
                    aria-label={`XP ${product.name}`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      saveProductXpMutation.mutate({
                        productId: product.id,
                        xp: Math.max(0, Number(draftValue) || 0),
                      })
                    }
                    disabled={!isDirty || isSaving}
                    className="h-9"
                  >
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isDirty ? (
                      <Save className="h-4 w-4" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    )}
                    {isSaving ? "Menyimpan..." : "Simpan"}
                  </Button>
                </div>
              );
            })}
            {filteredProducts.length > visibleProducts.length ? (
              <div className="px-4 py-3 text-center text-xs text-muted-foreground">
                Menampilkan {visibleProducts.length} dari {filteredProducts.length} produk — persempit
                lewat pencarian.
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <Dialog
        open={Boolean(tierForm)}
        onOpenChange={(open) => {
          if (!open && !saveTierMutation.isPending) setTierForm(null);
        }}
      >
        <DialogPanel size="md">
          <DialogPanelHeader>
            <DialogPanelTitle>Ubah tier: {tierForm?.code}</DialogPanelTitle>
            <DialogPanelDescription>
              Ambang XP, diskon, dan pengali XP untuk tier ini.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tier-name" className="text-xs text-muted-foreground">
                Nama tier
              </Label>
              <Input
                id="tier-name"
                value={tierForm?.name ?? ""}
                onChange={(event) =>
                  setTierForm((current) => current && { ...current, name: event.target.value })
                }
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tier-min-xp" className="text-xs text-muted-foreground">
                Min lifetime XP
              </Label>
              <Input
                id="tier-min-xp"
                type="number"
                min={0}
                value={tierForm?.min_lifetime_xp ?? ""}
                onChange={(event) =>
                  setTierForm((current) => current && { ...current, min_lifetime_xp: event.target.value })
                }
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tier-discount" className="text-xs text-muted-foreground">
                Diskon (%)
              </Label>
              <Input
                id="tier-discount"
                type="number"
                min={0}
                max={100}
                value={tierForm?.discount_percent ?? ""}
                onChange={(event) =>
                  setTierForm((current) =>
                    current && { ...current, discount_percent: event.target.value }
                  )
                }
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tier-multiplier" className="text-xs text-muted-foreground">
                Pengali XP
              </Label>
              <Input
                id="tier-multiplier"
                type="number"
                min={0}
                step={0.1}
                value={tierForm?.xp_multiplier ?? ""}
                onChange={(event) =>
                  setTierForm((current) => current && { ...current, xp_multiplier: event.target.value })
                }
                className={inputClass}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-200/70 bg-muted/40 px-3 py-2">
              <Label htmlFor="tier-active" className="text-sm text-foreground">
                Tier aktif
              </Label>
              <Switch
                id="tier-active"
                checked={tierForm?.is_active ?? false}
                onCheckedChange={(checked) =>
                  setTierForm((current) => current && { ...current, is_active: checked })
                }
              />
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTierForm(null)}
              disabled={saveTierMutation.isPending}
              className="h-10 rounded-lg border-gray-200/80"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={submitTier}
              disabled={saveTierMutation.isPending || !tierForm?.name.trim()}
              className="purchasing-main-button"
            >
              {saveTierMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saveTierMutation.isPending ? "Menyimpan..." : "Simpan tier"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <Dialog
        open={Boolean(ruleForm)}
        onOpenChange={(open) => {
          if (!open && !saveRuleMutation.isPending) setRuleForm(null);
        }}
      >
        <DialogPanel size="lg">
          <DialogPanelHeader>
            <DialogPanelTitle>
              {ruleFormIsNew ? "Aturan XP baru" : `Ubah aturan: ${ruleForm?.code}`}
            </DialogPanelTitle>
            <DialogPanelDescription>
              Tentukan sumber, mode, dan nilai XP untuk pembayaran ARK Coin.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rule-code" className="text-xs text-muted-foreground">
                Kode
              </Label>
              <Input
                id="rule-code"
                value={ruleForm?.code ?? ""}
                onChange={(event) =>
                  setRuleForm((current) => current && { ...current, code: event.target.value })
                }
                disabled={!ruleFormIsNew}
                placeholder="pos-order-amount"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-name" className="text-xs text-muted-foreground">
                Nama
              </Label>
              <Input
                id="rule-name"
                value={ruleForm?.name ?? ""}
                onChange={(event) =>
                  setRuleForm((current) => current && { ...current, name: event.target.value })
                }
                placeholder="XP per belanja"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-source" className="text-xs text-muted-foreground">
                Sumber
              </Label>
              <select
                id="rule-source"
                value={ruleForm?.source_type ?? "order_amount"}
                onChange={(event) =>
                  setRuleForm((current) => current && { ...current, source_type: event.target.value })
                }
                className={`w-full rounded-lg px-3 text-sm ${inputClass}`}
              >
                <option value="order_amount">Nominal order</option>
                <option value="product">Produk</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-mode" className="text-xs text-muted-foreground">
                Mode
              </Label>
              <select
                id="rule-mode"
                value={ruleForm?.xp_mode ?? "per_amount"}
                onChange={(event) =>
                  setRuleForm(
                    (current) =>
                      current && { ...current, xp_mode: event.target.value as RuleForm["xp_mode"] }
                  )
                }
                className={`w-full rounded-lg px-3 text-sm ${inputClass}`}
              >
                {Object.entries(XP_MODE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-xp" className="text-xs text-muted-foreground">
                Nilai XP
              </Label>
              <Input
                id="rule-xp"
                type="number"
                min={0}
                value={ruleForm?.xp_value ?? ""}
                onChange={(event) =>
                  setRuleForm((current) => current && { ...current, xp_value: event.target.value })
                }
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-step" className="text-xs text-muted-foreground">
                Step nominal (Rp)
              </Label>
              <Input
                id="rule-step"
                type="number"
                min={1}
                value={ruleForm?.amount_step ?? ""}
                onChange={(event) =>
                  setRuleForm((current) => current && { ...current, amount_step: event.target.value })
                }
                disabled={ruleForm?.xp_mode !== "per_amount"}
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-min" className="text-xs text-muted-foreground">
                Min transaksi (Rp)
              </Label>
              <Input
                id="rule-min"
                type="number"
                min={0}
                value={ruleForm?.min_amount ?? ""}
                onChange={(event) =>
                  setRuleForm((current) => current && { ...current, min_amount: event.target.value })
                }
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-max" className="text-xs text-muted-foreground">
                Maks XP per transaksi
              </Label>
              <Input
                id="rule-max"
                type="number"
                min={0}
                value={ruleForm?.max_xp_per_event ?? ""}
                onChange={(event) =>
                  setRuleForm((current) =>
                    current && { ...current, max_xp_per_event: event.target.value }
                  )
                }
                placeholder="Tanpa batas"
                className={inputClass}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-200/70 bg-muted/40 px-3 py-2">
              <Label className="text-sm text-foreground">Kalikan pengali tier</Label>
              <Switch
                checked={ruleForm?.tier_multiplier_enabled ?? false}
                onCheckedChange={(checked) =>
                  setRuleForm((current) => current && { ...current, tier_multiplier_enabled: checked })
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-200/70 bg-muted/40 px-3 py-2">
              <Label className="text-sm text-foreground">Aturan aktif</Label>
              <Switch
                checked={ruleForm?.is_active ?? false}
                onCheckedChange={(checked) =>
                  setRuleForm((current) => current && { ...current, is_active: checked })
                }
              />
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRuleForm(null)}
              disabled={saveRuleMutation.isPending}
              className="h-10 rounded-lg border-gray-200/80"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={submitRule}
              disabled={
                saveRuleMutation.isPending || !ruleForm?.code.trim() || !ruleForm?.name.trim()
              }
              className="purchasing-main-button"
            >
              {saveRuleMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saveRuleMutation.isPending ? "Menyimpan..." : "Simpan aturan"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
