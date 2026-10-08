"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/components/providers/theme-provider";
import {
  appearanceEquals,
  cloneAppearance,
  DEFAULT_APPEARANCE,
  FONT_SIZE_OPTIONS,
  parseAppearanceTokens,
  type AppearanceFontSize,
  type AppearanceTokens,
} from "@/lib/theme/appearance-tokens";
import type { ThemeMode } from "@/lib/theme/theme-state";
import { fetchCompanyAppearance, saveCompanyAppearance } from "../api";
import { AppearancePreview } from "./appearance-preview";

const BRAND_COLORS = [
  { name: "White Beige", hex: "#f3ece2", dark: false },
  { name: "Deep Forest Green", hex: "#00281a", dark: true },
  { name: "Pale Lime", hex: "#daff59", dark: false },
  { name: "Dark Jungle", hex: "#1c261b", dark: true },
  { name: "Everglade", hex: "#203b32", dark: true },
  { name: "Lettuce", hex: "#abde67", dark: false },
  { name: "Lemon Lime", hex: "#eeffb1", dark: false },
  { name: "Mint Cream", hex: "#fdfff2", dark: false },
  { name: "Golden Ochre", hex: "#c9a227", dark: false },
] as const;

export function AppearancePage() {
  const { applyAppearance } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [saved, setSaved] = useState<AppearanceTokens>(cloneAppearance());
  const [draft, setDraft] = useState<AppearanceTokens>(cloneAppearance());
  const [previewMode, setPreviewMode] = useState<Exclude<ThemeMode, "auto">>("light");

  const dirty = useMemo(() => !appearanceEquals(draft, saved), [draft, saved]);
  const companyName = companies.find((company) => company.id === companyId)?.name ?? null;

  useEffect(() => {
    let cancelled = false;
    fetchCompanyAppearance()
      .then((data) => {
        if (cancelled) return;
        const theme = parseAppearanceTokens(data.theme);
        setCompanies(data.companies);
        setCompanyId(data.company_id);
        setSaved(theme);
        setDraft(cloneAppearance(theme));
      })
      .catch(() => {
        if (!cancelled) toast.error("Gagal memuat tema perusahaan");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCompanyChange(nextId: string) {
    if (nextId === companyId) return;
    setLoading(true);
    try {
      const data = await fetchCompanyAppearance(nextId);
      const theme = parseAppearanceTokens(data.theme);
      setCompanyId(data.company_id);
      setCompanies(data.companies);
      setSaved(theme);
      setDraft(cloneAppearance(theme));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat tema");
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    if (!companyId || saving) return;
    setSaving(true);
    try {
      const res = await saveCompanyAppearance(companyId, draft);
      const theme = parseAppearanceTokens(res.data.theme);
      setSaved(theme);
      setDraft(cloneAppearance(theme));
      applyAppearance(theme);
      toast.success(res.message || "Tema perusahaan tersimpan");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan tema");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !companyId) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Appearance</h1>
          <p className="text-sm text-muted-foreground">
            Warna NüHabit dan keluarga font berlaku di seluruh aplikasi.
          </p>
        </div>
        {companies.length > 1 ? (
          <div className="w-64">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Company</p>
            <Select value={companyId ?? ""} onValueChange={handleCompanyChange}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="Pilih company" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{companyName}</p>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="p-4">
          <AppearancePreview
            tokens={draft}
            previewMode={previewMode}
            onPreviewModeChange={setPreviewMode}
            companyName={companyName}
          />
        </Card>

        <Card className="flex flex-col gap-5 p-4">
          <div>
            <h2 className="mb-2 text-sm font-semibold">Palet NüHabit</h2>
            <div className="grid grid-cols-3 gap-2">
              {BRAND_COLORS.map((color) => (
                <div
                  key={color.name}
                  className="flex min-h-20 flex-col justify-end rounded-lg p-2 text-[10px] leading-tight"
                  style={{
                    backgroundColor: color.hex,
                    color: color.dark ? "#fdfff2" : "#00281a",
                  }}
                >
                  <span className="font-semibold">{color.name}</span>
                  <span>{color.hex}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs font-medium text-muted-foreground">Font aplikasi</p>
            <p className="font-display text-lg font-semibold">Judul · Outfit</p>
            <p className="text-sm">Teks isi · Manrope</p>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Ukuran dasar</p>
            <Select
              value={String(draft.font.size)}
              onValueChange={(value) =>
                setDraft((previous) => ({
                  ...previous,
                  font: { ...previous.font, size: Number(value) as AppearanceFontSize },
                }))
              }
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-auto flex gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setDraft(cloneAppearance(DEFAULT_APPEARANCE))}
              disabled={saving}
            >
              Reset ke Default
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={handleApply}
              disabled={!companyId || saving || !dirty}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Apply
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
