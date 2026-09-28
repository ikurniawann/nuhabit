"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RotateCcw, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  applyChannelMarkup,
  markupPercentOf,
  resolveChannelPrice,
  ROUNDING_STEPS,
  roundingLabel,
  type ChannelRule,
  type RoundingMode,
  type RoundingStep,
} from "@/lib/pos/channel-pricing";
import { salesChannelSummary } from "@/lib/pos/sales-channels";
import { cn } from "@/lib/utils";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { fetchChannelPrices, saveChannelPrices, saveChannelRule, type ChannelPriceProduct } from "../api";

const rupiah = (value: number) => `Rp${Math.round(value).toLocaleString("id-ID")}`;
/** "30.000" / "Rp 30000" → 30000; kosong → null. */
const parseRupiah = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : null;
};
const formatDigits = (value: string) => {
  const parsed = parseRupiah(value);
  return parsed === null ? "" : parsed.toLocaleString("id-ID");
};

/** Integrasi otomatis baru tersedia untuk GoFood; channel lain dipakai sebagai referensi harga. */
const INTEGRATED = new Set(["gofood"]);

type RuleDraft = { markupPercent: string; roundingStep: RoundingStep; roundingMode: RoundingMode; isActive: boolean };

function ruleToDraft(rule: ChannelRule): RuleDraft {
  return {
    markupPercent: String(rule.markupPercent),
    roundingStep: rule.roundingStep,
    roundingMode: rule.roundingMode,
    isActive: rule.isActive,
  };
}

function draftToRule(base: ChannelRule, draft: RuleDraft): ChannelRule {
  const pct = Number(draft.markupPercent.replace(",", "."));
  return {
    ...base,
    markupPercent: Number.isFinite(pct) ? pct : 0,
    roundingStep: draft.roundingStep,
    roundingMode: draft.roundingMode,
    isActive: draft.isActive,
  };
}

export function ChannelPricesPage() {
  const [channelCode, setChannelCode] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["pos", "channel-prices", channelCode],
    queryFn: () => fetchChannelPrices(channelCode),
    // Refetch mereset draft editor (key dataUpdatedAt) — jangan saat pindah tab.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const data = query.data;
  const channel = data?.channel ?? null;

  return (
    <div className="space-y-5">
      <PurchasingPageHeader
        title="Harga Channel"
        description="Harga jual di GoFood, GrabFood, dan ShopeeFood: markup persen dari harga dasar, dibulatkan supaya rapi, dan tetap bisa diubah per produk."
      />

      {query.isError ? (
        <div className="rounded-lg border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-700">
          {query.error instanceof Error ? query.error.message : "Gagal memuat harga channel"}
        </div>
      ) : null}

      {data && data.channels.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {data.channels.map((item) => (
            <button
              key={item.code}
              type="button"
              onClick={() => setChannelCode(item.code)}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm font-semibold transition-colors",
                channel?.code === item.code
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/40"
              )}
            >
              {item.name}
              <span className="ml-2 text-xs font-normal">
                {item.isActive ? `+${item.markupPercent}%` : "nonaktif"}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {query.isLoading || !channel || !data ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          {query.isLoading ? <Loader2 className="size-5 animate-spin" /> : "Belum ada channel"}
        </div>
      ) : (
        // key → state draft mulai ulang saat pindah channel / data baru dimuat.
        <ChannelEditor key={`${channel.code}:${query.dataUpdatedAt}`} channel={channel} products={data.products} />
      )}
    </div>
  );
}

function ChannelEditor({ channel, products }: { channel: ChannelRule; products: ChannelPriceProduct[] }) {
  const queryClient = useQueryClient();
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(() => ruleToDraft(channel));
  /** product_id → teks input; "" = hapus harga manual (kembali otomatis). */
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [manualOnly, setManualOnly] = useState(false);

  const previewRule = draftToRule(channel, ruleDraft);
  const ruleDirty = JSON.stringify(ruleDraft) !== JSON.stringify(ruleToDraft(channel));
  const markupValid = previewRule.markupPercent >= 0 && previewRule.markupPercent <= 300;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["pos", "channel-prices"] });

  const ruleMutation = useMutation({
    mutationFn: () =>
      saveChannelRule(channel.code, {
        markup_percent: previewRule.markupPercent,
        rounding_step: previewRule.roundingStep,
        rounding_mode: previewRule.roundingMode,
        is_active: previewRule.isActive,
      }),
    onSuccess: async () => {
      toast.success(`Aturan harga ${channel.name} tersimpan.`);
      await invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal menyimpan aturan"),
  });

  const changes = useMemo(
    () =>
      Object.entries(priceDraft)
        .map(([productId, text]) => ({ product_id: productId, price: parseRupiah(text) }))
        .filter((change) => {
          const product = products.find((item) => item.id === change.product_id);
          return product && (product.override_price ?? null) !== change.price;
        }),
    [priceDraft, products]
  );

  const pricesMutation = useMutation({
    mutationFn: (body: Parameters<typeof saveChannelPrices>[1]) => saveChannelPrices(channel.code, body),
    onSuccess: async (result) => {
      toast.success(
        result.saved || result.cleared
          ? `Harga ${channel.name} tersimpan (${result.saved} manual, ${result.cleared} kembali otomatis).`
          : "Tidak ada perubahan."
      );
      await invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal menyimpan harga"),
  });

  const manualCount = products.filter((product) => product.override_price !== null).length;
  const needle = search.trim().toLowerCase();
  const visible = products.filter((product) => {
    if (manualOnly && product.override_price === null && !(product.id in priceDraft)) return false;
    if (!needle) return true;
    return `${product.name} ${product.category_name ?? ""} ${product.sku ?? ""}`.toLowerCase().includes(needle);
  });

  const examples = [18000, 25000, 32000].map((base) => `${rupiah(base)} → ${rupiah(applyChannelMarkup(base, previewRule))}`);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Aturan harga {channel.name}</h2>
            <p className="text-sm text-muted-foreground">
              Berlaku untuk semua produk tanpa harga manual, serta semua varian &amp; add-on.
              {INTEGRATED.has(channel.code)
                ? " Harga baru terkirim ke GoFood setelah \"Sinkron katalog\" di Settings → Integrasi."
                : ` ${channel.name} belum terintegrasi otomatis — harga ini jadi acuan saat input menu di aplikasi merchant.`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRuleDraft((draft) => ({ ...draft, isActive: !draft.isActive }))}
            className={cn(
              "flex shrink-0 items-center gap-3 rounded-lg border px-3 py-2 text-sm",
              ruleDraft.isActive
                ? "border-primary/30 bg-primary/5 text-foreground"
                : "border-border bg-muted/30 text-muted-foreground"
            )}
          >
            <span className="font-medium">{ruleDraft.isActive ? "Harga channel aktif" : "Pakai harga dasar"}</span>
            <span className={cn("relative h-5 w-9 rounded-full transition-colors", ruleDraft.isActive ? "bg-primary" : "bg-muted-foreground/30")}>
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform",
                  ruleDraft.isActive ? "left-4" : "left-0.5"
                )}
              />
            </span>
          </button>
        </div>

        <div className={cn("mt-4 grid gap-4 md:grid-cols-3", !ruleDraft.isActive && "opacity-50")}>
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">Markup (%)</span>
            <Input
              inputMode="decimal"
              disabled={!ruleDraft.isActive}
              value={ruleDraft.markupPercent}
              onChange={(event) => setRuleDraft((draft) => ({ ...draft, markupPercent: event.target.value }))}
              className="border-border"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">Pembulatan</span>
            <select
              disabled={!ruleDraft.isActive}
              value={ruleDraft.roundingStep}
              onChange={(event) =>
                setRuleDraft((draft) => ({ ...draft, roundingStep: Number(event.target.value) as RoundingStep }))
              }
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              {ROUNDING_STEPS.map((step) => (
                <option key={step} value={step}>
                  {step === 1 ? "Tanpa pembulatan" : `Kelipatan Rp${step.toLocaleString("id-ID")}`}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">Arah pembulatan</span>
            <select
              disabled={!ruleDraft.isActive || ruleDraft.roundingStep === 1}
              value={ruleDraft.roundingMode}
              onChange={(event) =>
                setRuleDraft((draft) => ({ ...draft, roundingMode: event.target.value as RoundingMode }))
              }
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="up">Ke atas (disarankan)</option>
              <option value="nearest">Terdekat</option>
              <option value="down">Ke bawah</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {ruleDraft.isActive
              ? `Contoh: ${examples.join(" · ")} (${roundingLabel(previewRule.roundingStep, previewRule.roundingMode).toLowerCase()})`
              : `Nonaktif: ${channel.name} memakai harga dasar, harga manual diabaikan.`}
            {ruleDirty ? " — pratinjau, belum disimpan." : ""}
          </p>
          <Button
            type="button"
            onClick={() => ruleMutation.mutate()}
            disabled={!ruleDirty || !markupValid || ruleMutation.isPending}
            className="gap-2"
          >
            {ruleMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Simpan aturan
          </Button>
        </div>
        {!markupValid ? <p className="mt-2 text-xs font-medium text-red-600">Markup harus 0–300%.</p> : null}
      </section>

      <section className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari produk / kategori"
              className="border-border pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setManualOnly((value) => !value)}
              className={cn(
                "rounded-md border px-3 py-1.5",
                manualOnly ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground"
              )}
            >
              Harga manual ({manualCount})
            </button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={manualCount === 0 || pricesMutation.isPending}
              onClick={() => {
                if (window.confirm(`Kembalikan semua ${manualCount} harga manual ${channel.name} ke harga otomatis?`)) {
                  setPriceDraft({});
                  pricesMutation.mutate({ reset_all: true });
                }
              }}
              className="gap-1.5"
            >
              <RotateCcw className="size-3.5" /> Reset semua
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Produk</th>
                <th className="px-4 py-2.5 text-right font-semibold">Harga dasar</th>
                <th className="px-4 py-2.5 text-right font-semibold">Otomatis</th>
                <th className="px-4 py-2.5 font-semibold">Harga {channel.name}</th>
                <th className="px-4 py-2.5 text-right font-semibold">Selisih</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((product) => {
                const drafted = product.id in priceDraft;
                const text = drafted
                  ? priceDraft[product.id]
                  : product.override_price !== null
                    ? product.override_price.toLocaleString("id-ID")
                    : "";
                const override = drafted ? parseRupiah(priceDraft[product.id]) : product.override_price;
                const resolved = resolveChannelPrice(product.base_price, previewRule, override);
                const diff = markupPercentOf(resolved.base, resolved.final);
                const belowBase = resolved.final < resolved.base;
                const unround =
                  resolved.isManual && previewRule.roundingStep > 1 && resolved.final % previewRule.roundingStep !== 0;
                return (
                  <tr key={product.id} className={cn(drafted && "bg-primary/5")}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-foreground">{product.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {product.category_name || "Tanpa kategori"}
                        {product.variant_count + product.modifier_count > 0 ? " · varian/add-on ikut markup" : ""}
                        {product.sales_channels?.length ? ` · dijual di: ${salesChannelSummary(product.sales_channels)}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{rupiah(resolved.base)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{rupiah(resolved.auto)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Input
                          inputMode="numeric"
                          disabled={!previewRule.isActive}
                          value={text}
                          placeholder={resolved.auto.toLocaleString("id-ID")}
                          onChange={(event) =>
                            setPriceDraft((draft) => ({ ...draft, [product.id]: formatDigits(event.target.value) }))
                          }
                          className="h-8 w-32 border-border text-right tabular-nums"
                        />
                        {resolved.isManual ? (
                          <>
                            <Badge variant="outline" className="border-primary/30 bg-primary/5 text-[10px] text-primary">
                              Manual
                            </Badge>
                            <button
                              type="button"
                              title="Kembali ke harga otomatis"
                              onClick={() => setPriceDraft((draft) => ({ ...draft, [product.id]: "" }))}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <RotateCcw className="size-3.5" />
                            </button>
                          </>
                        ) : null}
                      </div>
                      {belowBase || unround ? (
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
                          <AlertTriangle className="size-3" />
                          {belowBase ? "Di bawah harga dasar" : `Tidak kelipatan Rp${previewRule.roundingStep.toLocaleString("id-ID")}`}
                        </div>
                      ) : null}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2.5 text-right tabular-nums",
                        belowBase ? "text-amber-700" : "text-muted-foreground"
                      )}
                    >
                      {diff === null ? "—" : `${diff > 0 ? "+" : ""}${diff.toLocaleString("id-ID")}%`}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    Tidak ada produk yang cocok.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Kosongkan kolom = ikut harga otomatis. {changes.length > 0 ? `${changes.length} perubahan belum disimpan.` : ""}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={changes.length === 0 || pricesMutation.isPending}
              onClick={() => setPriceDraft({})}
            >
              Batalkan
            </Button>
            <Button
              type="button"
              disabled={changes.length === 0 || pricesMutation.isPending}
              onClick={() => pricesMutation.mutate({ prices: changes })}
              className="gap-2"
            >
              {pricesMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Simpan harga
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
