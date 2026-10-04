"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTheme } from "@/components/providers/theme-provider";
import {
  appearanceEquals,
  appearanceFromPreset,
  cloneAppearance,
  DEFAULT_APPEARANCE,
  FONT_GROUPS,
  FONT_OPTIONS,
  FONT_SIZE_OPTIONS,
  FONT_STACKS,
  parseAppearanceTokens,
  THEME_PRESETS,
  type AppearanceFontFamily,
  type AppearanceFontSize,
  type AppearanceTokens,
} from "@/lib/theme/appearance-tokens";
import type { ThemeMode } from "@/lib/theme/theme-state";
import { fetchCompanyAppearance, saveCompanyAppearance } from "../api";
import { AppearanceColorRow } from "./appearance-color-row";
import { AppearancePreview } from "./appearance-preview";

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
  const companyName = companies.find((c) => c.id === companyId)?.name ?? null;
  const fontOptions = useMemo(
    () =>
      FONT_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
        description: FONT_GROUPS.find((group) => group.id === option.group)?.label,
        style: { fontFamily: FONT_STACKS[option.value] },
      })),
    []
  );

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

  function handleReset() {
    setDraft(cloneAppearance(DEFAULT_APPEARANCE));
  }

  function patchBase<K extends keyof AppearanceTokens["base"]>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, base: { ...prev.base, [key]: value }, presetId: prev.presetId }));
  }

  function patchSidebar<K extends keyof AppearanceTokens["sidebar"]>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, sidebar: { ...prev.sidebar, [key]: value } }));
  }

  function patchNavbar<K extends keyof AppearanceTokens["navbar"]>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, navbar: { ...prev.navbar, [key]: value } }));
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
            Preview dulu, lalu Apply untuk menyimpan tema per company.
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

        <Card className="flex flex-col p-4">
          <Tabs defaultValue="base" className="w-full flex-col">
            <TabsList variant="line" className="grid h-9 w-full grid-cols-4">
              <TabsTrigger value="base">Base</TabsTrigger>
              <TabsTrigger value="sidebar">Sidebar</TabsTrigger>
              <TabsTrigger value="navbar">Navbar</TabsTrigger>
              <TabsTrigger value="font">Font</TabsTrigger>
            </TabsList>

            <TabsContent value="base" className="mt-3 space-y-3">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Preset</p>
                <div className="grid grid-cols-2 gap-2">
                  {THEME_PRESETS.map((preset) => {
                    const active = draft.presetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setDraft(appearanceFromPreset(preset.id, draft))}
                        className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs ${
                          active ? "border-primary ring-1 ring-primary/30" : "border-border"
                        }`}
                      >
                        <span
                          className="size-5 rounded-full"
                          style={{
                            background: `linear-gradient(135deg, ${preset.primary}, ${preset.secondary})`,
                          }}
                        />
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="divide-y divide-border/70">
                <AppearanceColorRow label="Background" value={draft.base.background} defaultValue={DEFAULT_APPEARANCE.base.background} onChange={(v) => patchBase("background", v)} />
                <AppearanceColorRow label="Foreground" value={draft.base.foreground} defaultValue={DEFAULT_APPEARANCE.base.foreground} onChange={(v) => patchBase("foreground", v)} />
                <AppearanceColorRow label="Card" value={draft.base.card} defaultValue={DEFAULT_APPEARANCE.base.card} onChange={(v) => patchBase("card", v)} />
                <AppearanceColorRow label="Primary" value={draft.base.primary} defaultValue={DEFAULT_APPEARANCE.base.primary} onChange={(v) => patchBase("primary", v)} />
                <AppearanceColorRow label="Destructive" value={draft.base.destructive} defaultValue={DEFAULT_APPEARANCE.base.destructive} onChange={(v) => patchBase("destructive", v)} />
                <AppearanceColorRow label="Border" value={draft.base.border} defaultValue={DEFAULT_APPEARANCE.base.border} onChange={(v) => patchBase("border", v)} />
                <AppearanceColorRow label="Input" value={draft.base.input} defaultValue={DEFAULT_APPEARANCE.base.input} onChange={(v) => patchBase("input", v)} />
                <AppearanceColorRow label="Focus Ring" value={draft.base.ring} defaultValue={DEFAULT_APPEARANCE.base.ring} onChange={(v) => patchBase("ring", v)} />
              </div>
            </TabsContent>

            <TabsContent value="sidebar" className="mt-3">
              <div className="divide-y divide-border/70">
                <AppearanceColorRow label="Background" value={draft.sidebar.background} defaultValue={DEFAULT_APPEARANCE.sidebar.background} onChange={(v) => patchSidebar("background", v)} />
                <AppearanceColorRow label="Teks" value={draft.sidebar.foreground} defaultValue={DEFAULT_APPEARANCE.sidebar.foreground} onChange={(v) => patchSidebar("foreground", v)} />
                <AppearanceColorRow label="Active background" value={draft.sidebar.activeBackground} defaultValue={DEFAULT_APPEARANCE.sidebar.activeBackground} onChange={(v) => patchSidebar("activeBackground", v)} />
                <AppearanceColorRow label="Active teks" value={draft.sidebar.activeForeground} defaultValue={DEFAULT_APPEARANCE.sidebar.activeForeground} onChange={(v) => patchSidebar("activeForeground", v)} />
                <AppearanceColorRow label="Border" value={draft.sidebar.border} defaultValue={DEFAULT_APPEARANCE.sidebar.border} onChange={(v) => patchSidebar("border", v)} />
              </div>
            </TabsContent>

            <TabsContent value="navbar" className="mt-3">
              <div className="divide-y divide-border/70">
                <AppearanceColorRow label="Background" value={draft.navbar.background} defaultValue={DEFAULT_APPEARANCE.navbar.background} onChange={(v) => patchNavbar("background", v)} />
                <AppearanceColorRow label="Teks" value={draft.navbar.foreground} defaultValue={DEFAULT_APPEARANCE.navbar.foreground} onChange={(v) => patchNavbar("foreground", v)} />
                <AppearanceColorRow label="Border" value={draft.navbar.border} defaultValue={DEFAULT_APPEARANCE.navbar.border} onChange={(v) => patchNavbar("border", v)} />
              </div>
            </TabsContent>

            <TabsContent value="font" className="mt-3 space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Font family</p>
                <Combobox
                  options={fontOptions}
                  value={draft.font.family}
                  onChange={(value) => {
                    if (!(value in FONT_STACKS)) return;
                    setDraft((prev) => ({
                      ...prev,
                      font: { ...prev.font, family: value as AppearanceFontFamily },
                    }));
                  }}
                  placeholder="Pilih font..."
                  searchPlaceholder="Cari font..."
                  emptyMessage="Font tidak ditemukan"
                  className="h-9 text-sm"
                />
                <p
                  className="mt-2 text-sm text-muted-foreground"
                  style={{ fontFamily: FONT_STACKS[draft.font.family] }}
                >
                  The quick brown fox jumps over the lazy dog
                </p>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Ukuran dasar</p>
                <Select
                  value={String(draft.font.size)}
                  onValueChange={(value) =>
                    setDraft((prev) => ({
                      ...prev,
                      font: { ...prev.font, size: Number(value) as AppearanceFontSize },
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
            </TabsContent>
          </Tabs>

          <div className="mt-auto flex gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handleReset}
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
