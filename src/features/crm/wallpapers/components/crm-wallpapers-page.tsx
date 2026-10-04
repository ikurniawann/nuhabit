"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  EyeOff,
  Image as ImageIcon,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { Wallpaper, WallpaperForm } from "../types";
import { useWallpapersList } from "../queries";
import { useDeleteWallpaper, useSaveWallpaper, useToggleWallpaper } from "../mutations";
import { formatNumber } from "@/lib/format";

const NO_WALLPAPERS: Wallpaper[] = [];

const defaultForm: WallpaperForm = {
  id: "",
  code: "",
  name: "",
  rarity: "common",
  image_url: "",
  thumbnail_url: "",
  min_lifetime_xp: "",
  required_tier_id: "",
  stock_total: "",
  is_active: true,
  starts_at: "",
  ends_at: "",
};

function toDateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function rarityTone(rarity: Wallpaper["rarity"]) {
  const tones: Record<Wallpaper["rarity"], string> = {
    common: "bg-slate-100 text-slate-700",
    rare: "bg-sky-50 text-sky-700",
    epic: "bg-violet-50 text-violet-700",
    legendary: "bg-amber-50 text-amber-700",
    limited: "bg-rose-50 text-rose-700",
  };
  return tones[rarity];
}

export function CrmWallpapersPage() {
  const [search, setSearch] = useState("");
  const [rarityFilter, setRarityFilter] = useState("all");
  const [form, setForm] = useState<WallpaperForm>(defaultForm);
  const [feedback, setFeedback] = useState<{ error: string | null; message: string | null }>({
    error: null,
    message: null,
  });

  const { data, isLoading, isFetching, error, refetch } = useWallpapersList();
  const saveMutation = useSaveWallpaper();
  const toggleMutation = useToggleWallpaper();
  const deleteMutation = useDeleteWallpaper();

  const wallpapers = data?.wallpapers ?? NO_WALLPAPERS;
  const tiers = data?.tiers ?? [];
  const loading = isLoading || isFetching;
  const queryError = error instanceof Error ? error.message : null;

  const filteredWallpapers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return wallpapers.filter((wallpaper) => {
      if (rarityFilter !== "all" && wallpaper.rarity !== rarityFilter) return false;
      if (!term) return true;
      return `${wallpaper.code} ${wallpaper.name} ${wallpaper.rarity}`.toLowerCase().includes(term);
    });
  }, [search, rarityFilter, wallpapers]);

  const summary = useMemo(() => ({
    active: wallpapers.filter((wallpaper) => wallpaper.is_active).length,
    stock: wallpapers.reduce((sum, wallpaper) => sum + (wallpaper.stock_total ?? 0), 0),
    redeemed: wallpapers.reduce((sum, wallpaper) => sum + Number(wallpaper.stock_redeemed ?? 0), 0),
  }), [wallpapers]);

  async function saveWallpaperHandler() {
    setFeedback({ error: null, message: null });

    try {
      await saveMutation.mutateAsync({
        ...(form.id ? { id: form.id } : {}),
        code: form.code,
        name: form.name,
        rarity: form.rarity,
        image_url: form.image_url,
        thumbnail_url: form.thumbnail_url || null,
        min_lifetime_xp: form.min_lifetime_xp === "" ? null : Math.max(0, Number(form.min_lifetime_xp) || 0),
        required_tier_id: form.required_tier_id || null,
        stock_total: form.stock_total === "" ? null : Math.max(1, Number(form.stock_total) || 1),
        is_active: form.is_active,
        starts_at: form.starts_at || null,
        ends_at: form.ends_at || null,
      });

      setForm(defaultForm);
      setFeedback({ error: null, message: "Wallpaper berhasil disimpan." });
    } catch (err) {
      setFeedback({
        error: err instanceof Error ? err.message : "Gagal menyimpan wallpaper",
        message: null,
      });
    }
  }

  function editWallpaper(wallpaper: Wallpaper) {
    setForm({
      id: wallpaper.id,
      code: wallpaper.code,
      name: wallpaper.name,
      rarity: wallpaper.rarity,
      image_url: wallpaper.image_url,
      thumbnail_url: wallpaper.thumbnail_url ?? "",
      min_lifetime_xp: wallpaper.min_lifetime_xp == null ? "" : String(wallpaper.min_lifetime_xp),
      required_tier_id: wallpaper.required_tier_id ?? "",
      stock_total: wallpaper.stock_total == null ? "" : String(wallpaper.stock_total),
      is_active: wallpaper.is_active,
      starts_at: toDateInput(wallpaper.starts_at),
      ends_at: toDateInput(wallpaper.ends_at),
    });
  }

  async function toggleWallpaperActive(wallpaper: Wallpaper) {
    setFeedback({ error: null, message: null });

    try {
      await toggleMutation.mutateAsync(wallpaper);
      if (form.id === wallpaper.id) {
        setForm((current) => ({ ...current, is_active: !wallpaper.is_active }));
      }
      setFeedback({
        error: null,
        message: `Wallpaper ${wallpaper.name} ${wallpaper.is_active ? "dinonaktifkan" : "diaktifkan"}.`,
      });
    } catch (err) {
      setFeedback({
        error: err instanceof Error ? err.message : "Gagal update status wallpaper",
        message: null,
      });
    }
  }

  async function deleteWallpaperHandler(wallpaper: Wallpaper) {
    setFeedback({ error: null, message: null });

    try {
      const result = await deleteMutation.mutateAsync(wallpaper.id);
      if (form.id === wallpaper.id) setForm(defaultForm);
      setFeedback({
        error: null,
        message: result.message || `Wallpaper ${wallpaper.name} berhasil dihapus.`,
      });
    } catch (err) {
      setFeedback({
        error: err instanceof Error ? err.message : "Gagal hapus wallpaper",
        message: null,
      });
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/dashboard/crm" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900">
              <ArrowLeft className="size-4" />
              CRM Dashboard
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">Collectible Wallpapers</h1>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {(queryError || feedback.error || feedback.message) && (
          <div className={`rounded-md border px-4 py-3 text-sm ${
            queryError || feedback.error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}>
            {queryError || feedback.error || feedback.message}
          </div>
        )}

        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={ImageIcon} label="Wallpapers" value={formatNumber(wallpapers.length)} />
          <MetricCard icon={Sparkles} label="Aktif" value={formatNumber(summary.active)} />
          <MetricCard icon={ImageIcon} label="Stok" value={formatNumber(summary.stock)} />
          <MetricCard icon={CheckCircle2} label="Ditukar" value={formatNumber(summary.redeemed)} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                <Plus className="size-4" />
                {form.id ? "Edit Wallpaper" : "Form Wallpaper"}
              </h2>
              {form.id && <div className="mt-1 text-xs text-slate-500">Mengedit {form.code}</div>}
            </div>
            <div className="space-y-4 p-4">
              {form.image_url ? (
                <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={form.thumbnail_url || form.image_url} alt={form.name || "Preview wallpaper"} className="h-40 w-full object-cover" />
                </div>
              ) : (
                <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-400">
                  <ImageIcon className="size-8" />
                </div>
              )}
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-600 transition hover:border-slate-400 hover:bg-slate-100">
                <input
                  type="file"
                  className="sr-only"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    const data = new FormData();
                    data.append("file", file);
                    const res = await fetch("/api/crm/avatars/upload", { method: "POST", body: data });
                    const json = await res.json().catch(() => ({}));
                    if (res.ok && json.success) {
                      setForm((current) => ({ ...current, image_url: json.data.url }));
                    } else {
                      alert(json.error || "Upload gagal");
                    }
                  }}
                />
                <ImageIcon className="size-4" /> Unggah Gambar Wallpaper (JPG/PNG/WebP, maks 5 MB)
              </label>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <TextField label="Code" value={form.code} onChange={(value) => setForm((current) => ({ ...current, code: value }))} placeholder="wallpaper-aurora-01" />
                <TextField label="Nama" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} placeholder="Aurora Nightscape" />
              </div>
              <TextField label="Image URL" value={form.image_url} onChange={(value) => setForm((current) => ({ ...current, image_url: value }))} placeholder="https://..." />
              <TextField label="Thumbnail URL" value={form.thumbnail_url} onChange={(value) => setForm((current) => ({ ...current, thumbnail_url: value }))} placeholder="Opsional" />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-medium text-slate-500">Rarity</span>
                  <select
                    value={form.rarity}
                    onChange={(event) => setForm((current) => ({ ...current, rarity: event.target.value as Wallpaper["rarity"] }))}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  >
                    <option value="common">Common</option>
                    <option value="rare">Rare</option>
                    <option value="epic">Epic</option>
                    <option value="legendary">Legendary</option>
                    <option value="limited">Limited</option>
                  </select>
                </label>
                <TextField
                  label="Ambang XP (min lifetime)"
                  type="number"
                  value={form.min_lifetime_xp}
                  onChange={(value) => setForm((current) => ({ ...current, min_lifetime_xp: value }))}
                  placeholder="Tanpa ambang"
                />
              </div>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-500">Tier Minimal</span>
                <select
                  value={form.required_tier_id}
                  onChange={(event) => setForm((current) => ({ ...current, required_tier_id: event.target.value }))}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                >
                  <option value="">Semua tier</option>
                  {tiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>{tier.name}</option>
                  ))}
                </select>
              </label>
              <TextField label="Stok" type="number" value={form.stock_total} onChange={(value) => setForm((current) => ({ ...current, stock_total: value }))} placeholder="Unlimited" />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Mulai" type="date" value={form.starts_at} onChange={(value) => setForm((current) => ({ ...current, starts_at: value }))} />
                <TextField label="Berakhir" type="date" value={form.ends_at} onChange={(value) => setForm((current) => ({ ...current, ends_at: value }))} />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
                  className="size-4 rounded border-slate-300"
                />
                Aktif
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setForm(defaultForm)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  {form.id ? (
                    <>
                      <X className="size-4" />
                      Batal
                    </>
                  ) : (
                    "Reset"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void saveWallpaperHandler()}
                  disabled={saveMutation.isPending || !form.code || !form.name || !form.image_url}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  <Save className="size-4" />
                  {form.id ? "Update" : "Simpan"}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-[1fr_180px]">
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari wallpaper..."
                  className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                />
              </label>
              <select
                value={rarityFilter}
                onChange={(event) => setRarityFilter(event.target.value)}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
              >
                <option value="all">Semua rarity</option>
                <option value="common">Common</option>
                <option value="rare">Rare</option>
                <option value="epic">Epic</option>
                <option value="legendary">Legendary</option>
                <option value="limited">Limited</option>
              </select>
            </div>

            {loading ? (
              <div className="px-4 py-12 text-center text-sm text-slate-500">Memuat wallpaper...</div>
            ) : filteredWallpapers.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-slate-500">Belum ada collectible wallpaper.</div>
            ) : (
              <div className="grid gap-3 p-4 lg:grid-cols-2">
                {filteredWallpapers.map((wallpaper) => {
                  const remainingStock = wallpaper.stock_total == null
                    ? null
                    : Math.max(0, wallpaper.stock_total - Number(wallpaper.stock_redeemed ?? 0));

                  return (
                    <div key={wallpaper.id} className="rounded-md border border-slate-200 p-3">
                      <div className="flex gap-3">
                        <div className="size-20 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={wallpaper.thumbnail_url || wallpaper.image_url} alt={wallpaper.name} className="size-full object-cover" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-slate-950">{wallpaper.name}</div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                            <span>{wallpaper.code}</span>
                            <span className={`rounded-sm px-1.5 py-0.5 ${rarityTone(wallpaper.rarity)}`}>{wallpaper.rarity}</span>
                            <span>{wallpaper.required_tier_name || "Semua tier"}</span>
                            <span className={wallpaper.is_active ? "text-emerald-700" : "text-slate-400"}>
                              {wallpaper.is_active ? "Aktif" : "Nonaktif"}
                            </span>
                          </div>
                          <div className="mt-2 text-sm font-semibold text-violet-700">
                            {wallpaper.min_lifetime_xp == null ? "Tanpa ambang XP" : `Ambang ${formatNumber(wallpaper.min_lifetime_xp)} XP`}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {remainingStock == null ? "Stok unlimited" : `Sisa ${formatNumber(remainingStock)}`} · {formatNumber(Number(wallpaper.stock_redeemed ?? 0))} ditukar
                          </div>
                          {(wallpaper.starts_at || wallpaper.ends_at) && (
                            <div className="mt-1 text-xs text-slate-400">
                              {toDateInput(wallpaper.starts_at) || "…"} s.d. {toDateInput(wallpaper.ends_at) || "…"}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => editWallpaper(wallpaper)}
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          <Pencil className="size-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleWallpaperActive(wallpaper)}
                          disabled={toggleMutation.isPending && toggleMutation.variables?.id === wallpaper.id}
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                        >
                          {wallpaper.is_active ? <EyeOff className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                          {wallpaper.is_active ? "Off" : "On"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteWallpaperHandler(wallpaper)}
                          disabled={deleteMutation.isPending && deleteMutation.variables === wallpaper.id}
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                        >
                          <Trash2 className="size-3.5" />
                          Hapus
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ImageIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex size-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
        <Icon className="size-5" />
      </div>
      <div className="text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
      />
    </label>
  );
}
