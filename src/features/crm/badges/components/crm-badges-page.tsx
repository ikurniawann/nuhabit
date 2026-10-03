"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Award,
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
  Users,
  X,
} from "lucide-react";
import { BADGE_METRICS, BADGE_METRIC_LABELS, badgeThreshold, describeBadgeRule } from "@/lib/crm/badges";
import type { Badge, BadgeForm } from "../types";
import { useBadgesList } from "../queries";
import { useDeleteBadge, useSaveBadge, useToggleBadge } from "../mutations";

const numberFormat = new Intl.NumberFormat("id-ID");

const defaultForm: BadgeForm = {
  id: "",
  code: "",
  name: "",
  image_url: "",
  metric: "lifetime_xp",
  threshold: "",
  bonus_xp: "0",
  is_active: true,
};

function formatNumber(value: number) {
  return numberFormat.format(value || 0);
}

export function CrmBadgesPage() {
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<BadgeForm>(defaultForm);
  const [feedback, setFeedback] = useState<{ error: string | null; message: string | null }>({
    error: null,
    message: null,
  });

  const { data, isLoading, isFetching, error, refetch } = useBadgesList();
  const saveMutation = useSaveBadge();
  const toggleMutation = useToggleBadge();
  const deleteMutation = useDeleteBadge();

  const badges = useMemo(() => data?.badges ?? [], [data]);
  const loading = isLoading || isFetching;
  const queryError = error instanceof Error ? error.message : null;

  const filteredBadges = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return badges;

    return badges.filter((badge) => `${badge.code} ${badge.name}`.toLowerCase().includes(term));
  }, [search, badges]);

  const summary = useMemo(() => ({
    active: badges.filter((badge) => badge.is_active).length,
    awarded: badges.reduce((sum, badge) => sum + Number(badge.awarded_count ?? 0), 0),
  }), [badges]);

  async function saveBadgeHandler() {
    setFeedback({ error: null, message: null });

    try {
      const threshold = Math.max(0, Number(form.threshold) || 0);
      await saveMutation.mutateAsync({
        ...(form.id ? { id: form.id } : {}),
        code: form.code,
        name: form.name,
        image_url: form.image_url || null,
        metric: form.metric,
        min_lifetime_xp: form.metric === "lifetime_xp" ? Math.floor(threshold) : 0,
        threshold: form.metric === "lifetime_xp" || form.metric === "manual" ? null : threshold,
        bonus_xp: Math.max(0, Math.floor(Number(form.bonus_xp) || 0)),
        is_active: form.is_active,
      });

      setForm(defaultForm);
      setFeedback({ error: null, message: "Badge berhasil disimpan." });
    } catch (err) {
      setFeedback({
        error: err instanceof Error ? err.message : "Gagal menyimpan badge",
        message: null,
      });
    }
  }

  function editBadge(badge: Badge) {
    setForm({
      id: badge.id,
      code: badge.code,
      name: badge.name,
      image_url: badge.image_url ?? "",
      metric: badge.metric,
      threshold: String(badgeThreshold(badge) ?? ""),
      bonus_xp: String(badge.bonus_xp ?? 0),
      is_active: badge.is_active,
    });
  }

  async function toggleBadgeActive(badge: Badge) {
    setFeedback({ error: null, message: null });

    try {
      await toggleMutation.mutateAsync(badge);
      if (form.id === badge.id) {
        setForm((current) => ({ ...current, is_active: !badge.is_active }));
      }
      setFeedback({
        error: null,
        message: `Badge ${badge.name} ${badge.is_active ? "dinonaktifkan" : "diaktifkan"}.`,
      });
    } catch (err) {
      setFeedback({
        error: err instanceof Error ? err.message : "Gagal update status badge",
        message: null,
      });
    }
  }

  async function deleteBadgeHandler(badge: Badge) {
    setFeedback({ error: null, message: null });

    try {
      const result = await deleteMutation.mutateAsync(badge.id);
      if (form.id === badge.id) setForm(defaultForm);
      setFeedback({
        error: null,
        message: result.message || `Badge ${badge.name} berhasil dihapus.`,
      });
    } catch (err) {
      setFeedback({
        error: err instanceof Error ? err.message : "Gagal hapus badge",
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
            <h1 className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">Badge</h1>
            <p className="mt-1 text-sm text-slate-500">
              Badge diberikan otomatis saat member mencapai ambang metriknya (lifetime XP, kunjungan,
              total belanja, atau minggu berturut-turut). Badge manual diberikan dari detail member.
            </p>
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

        <section className="grid gap-3 md:grid-cols-3">
          <MetricCard icon={Award} label="Badge" value={formatNumber(badges.length)} />
          <MetricCard icon={Sparkles} label="Aktif" value={formatNumber(summary.active)} />
          <MetricCard icon={Users} label="Total Diraih" value={formatNumber(summary.awarded)} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                <Plus className="size-4" />
                {form.id ? "Edit Badge" : "Form Badge"}
              </h2>
              {form.id && <div className="mt-1 text-xs text-slate-500">Mengedit {form.code}</div>}
            </div>
            <div className="space-y-4 p-4">
              {form.image_url ? (
                <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={form.image_url} alt={form.name || "Preview badge"} className="h-40 w-full object-contain" />
                </div>
              ) : (
                <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-400">
                  <Award className="size-8" />
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
                <ImageIcon className="size-4" /> Unggah Gambar Badge (JPG/PNG/WebP, maks 5 MB) — opsional
              </label>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <TextField label="Code" value={form.code} onChange={(value) => setForm((current) => ({ ...current, code: value }))} placeholder="badge-explorer-01" />
                <TextField label="Nama" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} placeholder="First Explorer" />
              </div>
              <TextField label="Image URL (opsional)" value={form.image_url} onChange={(value) => setForm((current) => ({ ...current, image_url: value }))} placeholder="https://..." />
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-500">Metrik</span>
                <select
                  value={form.metric}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, metric: event.target.value as BadgeForm["metric"] }))
                  }
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  {BADGE_METRICS.map((metric) => (
                    <option key={metric} value={metric}>
                      {BADGE_METRIC_LABELS[metric]}
                    </option>
                  ))}
                </select>
              </label>
              {form.metric !== "manual" && (
                <TextField
                  label={`Ambang ${BADGE_METRIC_LABELS[form.metric].toLowerCase()}`}
                  type="number"
                  value={form.threshold}
                  onChange={(value) => setForm((current) => ({ ...current, threshold: value }))}
                  placeholder={form.metric === "spend_idr" ? "1000000" : "10"}
                />
              )}
              <TextField
                label="Bonus XP saat badge diraih (sekali)"
                type="number"
                value={form.bonus_xp}
                onChange={(value) => setForm((current) => ({ ...current, bonus_xp: value }))}
                placeholder="0"
              />
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
                  onClick={() => void saveBadgeHandler()}
                  disabled={
                    saveMutation.isPending ||
                    !form.code ||
                    !form.name ||
                    (form.metric !== "manual" && form.threshold === "") ||
                    (form.metric !== "manual" && form.metric !== "lifetime_xp" && !(Number(form.threshold) > 0))
                  }
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  <Save className="size-4" />
                  {form.id ? "Update" : "Simpan"}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-4">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari badge..."
                  className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                />
              </label>
            </div>

            {loading ? (
              <div className="px-4 py-12 text-center text-sm text-slate-500">Memuat badge...</div>
            ) : filteredBadges.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-slate-500">Belum ada badge.</div>
            ) : (
              <div className="grid gap-3 p-4 lg:grid-cols-2">
                {filteredBadges.map((badge) => (
                  <div key={badge.id} className="rounded-md border border-slate-200 p-3">
                    <div className="flex gap-3">
                      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                        {badge.image_url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={badge.image_url} alt={badge.name} className="size-full object-contain" />
                        ) : (
                          <Award className="size-8 text-slate-300" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-950">{badge.name}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                          <span>{badge.code}</span>
                          <span className={badge.is_active ? "text-emerald-700" : "text-slate-400"}>
                            {badge.is_active ? "Aktif" : "Nonaktif"}
                          </span>
                        </div>
                        <div className="mt-2 text-sm font-semibold text-violet-700">
                          {describeBadgeRule(badge)}
                        </div>
                        {badge.bonus_xp > 0 && (
                          <div className="text-xs text-slate-500">Bonus {formatNumber(badge.bonus_xp)} XP</div>
                        )}
                        <div className="mt-1 text-xs text-slate-500">
                          Diraih {formatNumber(Number(badge.awarded_count ?? 0))} member
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => editBadge(badge)}
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                      >
                        <Pencil className="size-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleBadgeActive(badge)}
                        disabled={toggleMutation.isPending && toggleMutation.variables?.id === badge.id}
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                      >
                        {badge.is_active ? <EyeOff className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                        {badge.is_active ? "Off" : "On"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteBadgeHandler(badge)}
                        disabled={deleteMutation.isPending && deleteMutation.variables === badge.id}
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 className="size-3.5" />
                        Hapus
                      </button>
                    </div>
                  </div>
                ))}
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
  icon: typeof Award;
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
