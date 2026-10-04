"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useXpRulesList } from "../queries";
import { useSaveXpRule } from "../mutations";
import {
  XP_MODES,
  XP_SOURCE_CHANNELS,
  XP_SOURCE_TYPES,
  type XpMode,
  type XpRule,
  type XpRuleForm,
  type XpSourceChannel,
} from "../types";
import { formatNumber, formatRupiah } from "@/lib/format";

/**
 * EPIC-011 lanjutan — kelola aturan perolehan XP.
 *
 * Aturan TIDAK dihapus, hanya dinonaktifkan: `crm_xp_ledger.rule_id` menunjuk
 * ke baris ini, sehingga menghapusnya akan memutus jejak asal-usul XP yang
 * sudah terlanjur diberikan.
 */

const CHANNEL_LABELS: Record<XpSourceChannel, string> = {
  pos: "POS / Kasir",
  photobooth: "Photobooth",
  studio_game: "Studio Game",
  manual: "Manual",
  campaign: "Campaign",
};

const MODE_LABELS: Record<XpMode, string> = {
  fixed: "Tetap — sekian XP per transaksi",
  per_item: "Per item — sekian XP tiap barang",
  per_amount: "Per nominal — sekian XP tiap kelipatan rupiah",
  multiplier: "Pengali — XP dasar dikalikan",
  percentage: "Persentase — sekian persen dari nominal",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  product: "Per item pesanan — dihitung tiap baris produk",
  order_amount: "Nilai pesanan — dipakai bila tidak ada aturan per item",
  split_payment: "Pembayaran terpisah (split bill)",
};

const SOURCE_TYPE_SHORT: Record<string, string> = {
  product: "Per item",
  order_amount: "Nilai pesanan",
  split_payment: "Split bill",
};

const MODE_SHORT: Record<XpMode, string> = {
  fixed: "Tetap",
  per_item: "Per item",
  per_amount: "Per nominal",
  multiplier: "Pengali",
  percentage: "Persentase",
};

const KOSONG: XpRuleForm = {
  id: "",
  code: "",
  name: "",
  source_channel: "pos",
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

/**
 * Kolom numeric dikirim pg sebagai string berdesimal ("1.0000", "1000.00").
 * Untuk input form: bersihkan nol desimal — "1" dan "1000", bukan apa adanya.
 * parseFloat (bukan Math.round) supaya nilai pecahan sungguhan tidak diubah.
 */
const utuh = (value: unknown, fallback = ""): string => {
  const n = Number(value);
  return Number.isFinite(n) ? String(parseFloat(n.toFixed(4))) : fallback;
};

/** Ringkasan aturan dalam bahasa manusia — agar tidak perlu menerka kolom. */
function ringkasan(rule: XpRule): string {
  const nilai = Number(rule.xp_value) || 0;
  switch (rule.xp_mode) {
    case "fixed":
      return `${formatNumber(nilai)} XP per transaksi`;
    case "per_item":
      return `${formatNumber(nilai)} XP per item`;
    case "per_amount":
      return `${formatNumber(nilai)} XP tiap ${formatRupiah(Number(rule.amount_step) || 1)}`;
    case "multiplier":
      return `XP dasar dikalikan ${nilai}`;
    case "percentage":
      return `${nilai}% dari nominal`;
    default:
      return `${formatNumber(nilai)} XP`;
  }
}

export function CrmXpRulesPage() {
  const [channel, setChannel] = useState<string>("");
  const rulesQuery = useXpRulesList({ source_channel: channel || undefined });
  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data]);
  const saveMutation = useSaveXpRule();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<XpRuleForm>(KOSONG);
  const [error, setError] = useState<string | null>(null);

  const adaAturanAktif = rules.some((rule) => rule.is_active);

  function bukaBaru() {
    setForm(KOSONG);
    setError(null);
    setOpen(true);
  }

  function bukaEdit(rule: XpRule) {
    setForm({
      id: rule.id,
      code: rule.code,
      name: rule.name,
      source_channel: rule.source_channel,
      source_type: rule.source_type,
      xp_mode: rule.xp_mode,
      xp_value: utuh(rule.xp_value),
      amount_step: utuh(rule.amount_step, "1"),
      min_amount: utuh(rule.min_amount, "0"),
      max_xp_per_event: rule.max_xp_per_event == null ? "" : utuh(rule.max_xp_per_event),
      tier_multiplier_enabled: rule.tier_multiplier_enabled,
      priority: String(rule.priority ?? 100),
      is_active: rule.is_active,
    });
    setError(null);
    setOpen(true);
  }

  async function simpan() {
    setError(null);
    try {
      await saveMutation.mutateAsync({
        code: form.code.trim().toLowerCase(),
        name: form.name.trim(),
        source_channel: form.source_channel,
        source_type: form.source_type.trim(),
        source_id: null,
        outlet_scope: "all",
        outlet_id: null,
        xp_mode: form.xp_mode,
        xp_value: Number(form.xp_value) || 0,
        amount_step: Math.max(1, Number(form.amount_step) || 1),
        min_amount: Math.max(0, Number(form.min_amount) || 0),
        max_xp_per_event: form.max_xp_per_event ? Number(form.max_xp_per_event) : null,
        tier_multiplier_enabled: form.tier_multiplier_enabled,
        priority: Number(form.priority) || 100,
        starts_at: null,
        ends_at: null,
        is_active: form.is_active,
        metadata: {},
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan aturan");
    }
  }

  /** Nonaktifkan tanpa membuka dialog — jejak ledger tetap utuh. */
  async function ubahAktif(rule: XpRule, aktif: boolean) {
    await saveMutation.mutateAsync({
      code: rule.code,
      name: rule.name,
      source_channel: rule.source_channel,
      source_type: rule.source_type,
      source_id: rule.source_id,
      outlet_scope: rule.outlet_scope,
      outlet_id: rule.outlet_id,
      xp_mode: rule.xp_mode,
      xp_value: Number(rule.xp_value) || 0,
      amount_step: Number(rule.amount_step) || 1,
      min_amount: Number(rule.min_amount) || 0,
      max_xp_per_event: rule.max_xp_per_event,
      tier_multiplier_enabled: rule.tier_multiplier_enabled,
      priority: rule.priority,
      starts_at: rule.starts_at,
      ends_at: rule.ends_at,
      is_active: aktif,
      metadata: {},
    });
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <Sparkles className="size-5 text-violet-600" /> Aturan XP
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Menentukan berapa XP yang diperoleh member dari tiap transaksi. Tanpa aturan aktif,
            transaksi tidak menghasilkan XP sama sekali.
          </p>
        </div>
        <Button onClick={bukaBaru}>
          <Plus className="size-4" /> Aturan baru
        </Button>
      </header>

      {!rulesQuery.isLoading && !adaAturanAktif && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong>Belum ada aturan XP yang aktif.</strong> Selama ini kosong, belanja di POS
            tidak menambah XP member dan tidak ada catatan yang masuk ke riwayat XP.
          </p>
        </div>
      )}

      <div className="w-56">
        <Combobox
          options={[
            { value: "", label: "Semua kanal" },
            ...XP_SOURCE_CHANNELS.map((value) => ({ value, label: CHANNEL_LABELS[value] })),
          ]}
          value={channel}
          onChange={setChannel}
          placeholder="Semua kanal"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Aturan</th>
              <th className="px-4 py-3">Kanal</th>
              <th className="px-4 py-3">Perhitungan</th>
              <th className="px-4 py-3">Min. belanja</th>
              <th className="px-4 py-3">Prioritas</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rulesQuery.isLoading ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-400">
                  <Loader2 className="mx-auto size-6 animate-spin" />
                </td>
              </tr>
            ) : rules.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-400">
                  Belum ada aturan. Mulai dengan menekan “Aturan baru”.
                </td>
              </tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{rule.name}</p>
                    <p className="font-mono text-xs text-slate-400">{rule.code}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{CHANNEL_LABELS[rule.source_channel]}</p>
                    <p className="text-xs text-slate-400">
                      {SOURCE_TYPE_SHORT[rule.source_type] ?? rule.source_type}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{ringkasan(rule)}</p>
                    <p className="text-xs text-slate-400">{MODE_SHORT[rule.xp_mode]}</p>
                  </td>
                  <td className="px-4 py-3">
                    {Number(rule.min_amount) > 0 ? formatRupiah(rule.min_amount) : "—"}
                  </td>
                  <td className="px-4 py-3">{rule.priority}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        rule.is_active
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {rule.is_active ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => bukaEdit(rule)}>
                        Ubah
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={saveMutation.isPending}
                        onClick={() => void ubahAktif(rule, !rule.is_active)}
                      >
                        {rule.is_active ? "Nonaktifkan" : "Aktifkan"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Ubah Aturan XP" : "Aturan XP Baru"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Kode"
              hint="Unik; dipakai sistem. Menyimpan kode yang sama akan menimpa aturan itu."
              value={form.code}
              onChange={(v) => setForm((f) => ({ ...f, code: v }))}
            />
            <Field
              label="Nama"
              value={form.name}
              onChange={(v) => setForm((f) => ({ ...f, name: v }))}
            />

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Kanal</label>
              <Combobox
                options={XP_SOURCE_CHANNELS.map((value) => ({
                  value,
                  label: CHANNEL_LABELS[value],
                }))}
                value={form.source_channel}
                onChange={(v) => setForm((f) => ({ ...f, source_channel: v as XpSourceChannel }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Jenis kejadian
              </label>
              <Combobox
                options={XP_SOURCE_TYPES.map((value) => ({
                  value,
                  label: SOURCE_TYPE_LABELS[value] ?? value,
                }))}
                value={form.source_type}
                onChange={(v) => setForm((f) => ({ ...f, source_type: v }))}
              />
              <p className="mt-0.5 text-[11px] text-slate-400">
                Harus salah satu dari daftar ini; nilai lain tidak akan pernah cocok.
              </p>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600">Perhitungan</label>
              <Combobox
                options={XP_MODES.map((value) => ({ value, label: MODE_LABELS[value] }))}
                value={form.xp_mode}
                onChange={(v) => setForm((f) => ({ ...f, xp_mode: v as XpMode }))}
              />
            </div>

            <Field
              label="Nilai XP"
              numeric
              satuan="XP"
              value={form.xp_value}
              onChange={(v) => setForm((f) => ({ ...f, xp_value: v }))}
            />
            <Field
              label="Kelipatan rupiah"
              hint="Dipakai mode Per nominal."
              numeric
              satuan="Rp"
              value={form.amount_step}
              onChange={(v) => setForm((f) => ({ ...f, amount_step: v }))}
            />
            <Field
              label="Minimal belanja"
              hint="0 = tanpa minimum."
              numeric
              satuan="Rp"
              value={form.min_amount}
              onChange={(v) => setForm((f) => ({ ...f, min_amount: v }))}
            />
            <Field
              label="Batas XP per transaksi"
              hint="Kosong = tanpa batas."
              numeric
              satuan="XP"
              value={form.max_xp_per_event}
              onChange={(v) => setForm((f) => ({ ...f, max_xp_per_event: v }))}
            />
            <Field
              label="Prioritas"
              hint="Makin kecil makin didahulukan."
              value={form.priority}
              onChange={(v) => setForm((f) => ({ ...f, priority: v }))}
            />

            <label className="flex items-center gap-2 self-end pb-1 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.tier_multiplier_enabled}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tier_multiplier_enabled: e.target.checked }))
                }
              />
              Ikut pengali tier
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              />
              Aktif
            </label>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={() => void simpan()}
              disabled={saveMutation.isPending || !form.code.trim() || !form.name.trim()}
            >
              {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />} Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  numeric = false,
  satuan,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  /** "Rp" → pratinjau "Rp1.000"; "XP" → pratinjau "1 XP". */
  satuan?: "Rp" | "XP";
}) {
  const n = Number(value);
  const pratinjau =
    numeric && satuan && value !== "" && Number.isFinite(n)
      ? satuan === "Rp"
        ? formatRupiah(n)
        : `${formatNumber(n, 4)} XP`
      : null;

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <div className="relative">
        <input
          value={value}
          inputMode={numeric ? "numeric" : undefined}
          onChange={(event) =>
            onChange(numeric ? event.target.value.replace(/[^\d.,]/g, "") : event.target.value)
          }
          className="h-9 w-full rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
        {pratinjau && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            {pratinjau}
          </span>
        )}
      </div>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}
